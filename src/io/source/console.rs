use core::cell::{Cell, OnceCell};
use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, Ordering};
use std::os::windows::io::{AsHandle as _, AsRawHandle as _, OwnedHandle};
use std::rc::{Rc, Weak};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use bun_iocp::blocking::{self, Cancel, Turnstile};
use bun_iocp::{Port, Remote, Request};
use bun_ptr::OptionCellExt as _;
use bun_sys::windows::{self as w, HANDLE, Win32Error, console};
use bun_sys::windows_format::key_input::{self, InputRecord, Utf16Decoder};
use bun_sys::{self as sys, E, Fd, File, Tag};
use bun_threading::guarded::GuardedLock;
use bun_threading::{Condition, Guarded, Mutex};

use super::Payload;
use super::endpoint::{Endpoint, HasEndpoint};
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

// ── input ────────────────────────────────────────────────────────────────

/// A process has one console, and every handle to its input takes from the same queue.
struct Input {
    handle: OwnedHandle,
    /// From `read_line` to `watch_lines`.
    turnstile: Turnstile,
}

impl Input {
    /// `handle` is what there is to fall back on.
    fn get(handle: HANDLE) -> Result<&'static Input, Win32Error> {
        static INPUT: OnceLock<Input> = OnceLock::new();
        if let Some(input) = INPUT.get() {
            return Ok(input);
        }
        let input = Input {
            handle: open_input().or_else(|_| w::duplicate_handle(handle))?,
            turnstile: Turnstile::new()?,
        };
        Ok(INPUT.get_or_init(|| input))
    }

    fn raw(&self) -> HANDLE {
        self.handle.as_raw_handle()
    }

    fn is_signalled(&self) -> bool {
        w::kernel32::WaitForSingleObject(self.raw(), 0) == 0
    }

    /// The console passes its queue on to a read that waits, and who takes the last record resets the handle.
    fn write_ignored(&self) -> Result<usize, Win32Error> {
        let record = InputRecord {
            event_type: key_input::MENU_EVENT,
            ..Default::default()
        };
        console::write_records(self.raw(), &[record])
    }
}

fn open_input() -> Result<OwnedHandle, Win32Error> {
    console::open(bun_core::wstr!("CONIN$"))
}

static IS_RAW: AtomicBool = AtomicBool::new(false);

enum Line {
    Idle,
    Starting,
    /// The console goes on with a cancelled read until the handle is closed, so it takes a handle of our own to cancel.
    Reading(Option<Cancel>),
}

struct Shared {
    line: Line,
    /// How many times it was `Line::Reading`.
    reads: usize,
    is_watched: bool,
    /// Who is told that `line` is idle again or raw mode is over, by the address of its `Inner`.
    readers: Vec<(usize, Remote<()>)>,
    /// Taken from the console, and not handed to a reader yet.
    text: Vec<u8>,
    end: Option<ReadEvent>,
    decoder: Utf16Decoder,
    /// How many `WAKE`s were put in the queue, and have not come out.
    wakes: usize,
    /// For the next `Line::Reading`.
    line_handle: Option<OwnedHandle>,
}

static SHARED: Guarded<Shared> = Guarded::new(Shared {
    line: Line::Idle,
    reads: 0,
    is_watched: false,
    readers: Vec::new(),
    text: Vec::new(),
    end: None,
    decoder: Utf16Decoder::new(),
    wakes: 0,
    line_handle: None,
});
static LINE_IS_IDLE: Condition = Condition::new();

/// Ends a read without an echo, or an entry in the history.
const WAKE: u16 = 0x1E;
const END: u16 = 0x23;

/// Unlike a key that was pressed, it has no scan code.
fn key(virtual_key: u16, character: u16) -> InputRecord {
    InputRecord {
        event_type: key_input::KEY_EVENT,
        is_key_down: 1,
        repeat_count: 1,
        virtual_key,
        character,
        ..Default::default()
    }
}

impl Shared {
    fn is_reading(&self) -> bool {
        matches!(self.line, Line::Reading(_))
    }

    fn take_wake(&mut self, character: u16) -> bool {
        let is_wake = character == WAKE && self.wakes > 0;
        self.wakes -= usize::from(is_wake);
        is_wake
    }

    fn fail(&mut self, err: Win32Error) {
        self.end = Some(match err {
            Win32Error::BROKEN_PIPE | Win32Error::NO_DATA | Win32Error::PIPE_NOT_CONNECTED => {
                ReadEvent::Eof
            }
            err => ReadEvent::Err(sys::Error::from_win32(err, Tag::recv)),
        });
    }

    fn read_keys(&mut self, input: &Input) {
        const BATCH: usize = 256;
        let mut records = [InputRecord::default(); BATCH];
        let mut is_resized = false;
        // What was pasted comes in pieces of some KiB, as from a terminal.
        for _ in 0..32 {
            let records = match console::read_records(input.raw(), &mut records) {
                Ok(records) => records,
                Err(err) => return self.fail(err),
            };
            // A change of the screen buffer empties the queue and leaves the handle signalled.
            if records.is_empty() && input.is_signalled() {
                let _ = input.write_ignored();
            }
            for record in records {
                is_resized |= record.event_type == key_input::WINDOW_BUFFER_SIZE_EVENT;
                let is_ours = *record == key(END, 0) && self.wakes > 0;
                if !is_ours && !(record.is_input() && self.take_wake(record.character)) {
                    key_input::translate(record, &mut self.decoder, &mut self.text);
                }
            }
            if records.len() < BATCH || self.text.len() >= 4096 {
                break;
            }
        }
        if is_resized {
            crate::console_signals::check_window_size();
        }
    }

    fn add_line(&mut self, line: &[u16]) {
        const CTRL_Z: u16 = 0x1A;
        if let [CTRL_Z, .., 0x0A] = line {
            self.end = Some(ReadEvent::Eof);
            return;
        }
        for &unit in line {
            if !self.take_wake(unit) {
                self.decoder.push(unit, &mut self.text);
            }
        }
    }
}

/// A console before microsoft/terminal#18816 sits on a key that comes while it sets up a read, until the next record.
fn watch_lines(input: &Input) {
    let mut was_signalled_in = None;
    loop {
        input.turnstile.wait();
        let shared = SHARED.lock();
        let read = (shared.is_reading() && !shared.readers.is_empty()).then_some(shared.reads);
        drop(shared);
        if read.is_none() || (read == was_signalled_in && input.write_ignored().is_err()) {
            continue;
        }
        input.turnstile.admit_after(input.handle.as_handle());
        // The console answers in order, so it has seen the read by the time it has answered this.
        let is_signalled = console::is_input(input.raw()) && input.is_signalled();
        was_signalled_in = read.filter(|_| is_signalled);
        if !is_signalled {
            // The read drops the record that tells.
            crate::console_signals::check_window_size();
        }
    }
}

fn read_line(input: &'static Input) {
    // Older consoles take no more keys once it is full.
    let mut buffer = vec![0; 8192];
    let capacity = buffer.len();
    let mut shared = SHARED.lock();
    if !shared.readers.is_empty() && !IS_RAW.load(Ordering::SeqCst) {
        let own = shared.line_handle.take().or_else(|| open_input().ok());
        let cancel = Cancel::default();
        shared.is_watched = shared.is_watched || blocking::spawn_endless(|| watch_lines(input));
        input.turnstile.admit();
        shared.reads += 1;
        shared.line = Line::Reading(own.is_some().then(|| cancel.clone()));
        drop(shared);

        let handle = own.as_ref().unwrap_or(&input.handle).as_raw_handle();
        shared = loop {
            let line = cancel.run(|| console::read_text(handle, &mut buffer, WAKE));
            let line = line.unwrap_or(Ok(&[]));
            let mut shared = SHARED.lock();
            match line {
                Ok(line) => shared.add_line(line),
                // A character that the console has choked on.
                Err(Win32Error::OPERATION_ABORTED | Win32Error::INVALID_PARAMETER) => {}
                Err(err) => shared.fail(err),
            }
            // The rest of a long line is not in the queue any more.
            let has_rest = |line: &[u16]| {
                line.len() == capacity && !matches!(line, [.., 0x0D, 0x0A] | [.., WAKE])
            };
            if !line.is_ok_and(has_rest) {
                shared.line_handle = own.filter(|_| !cancel.is_cancelled());
                break shared;
            }
        };
    }
    shared.line = Line::Idle;
    LINE_IS_IDLE.notify_all();
    tell_readers(shared);
}

fn tell_readers(mut shared: GuardedLock<'_, Shared, Mutex>) {
    let readers = core::mem::take(&mut shared.readers);
    drop(shared);
    // The newest gets the line.
    for (_, reader) in readers.into_iter().rev() {
        reader.complete(());
    }
}

/// What the read returns is kept for the next reader, also if it does not end now.
fn stop_line(input: &Input) {
    const PATIENCE: Duration = Duration::from_millis(50);
    let mut shared = SHARED.lock();
    let Line::Reading(cancel) = &shared.line else {
        return;
    };
    // `WAKE` takes the place of what follows the cursor. End would be text where the console makes escape sequences.
    let is_vt = |mode| mode & w::ENABLE_VIRTUAL_TERMINAL_INPUT != 0;
    let first = usize::from(console::mode(input.raw()).is_ok_and(is_vt));
    let write = || console::write_records(input.raw(), &[key(END, 0), key(0, WAKE)][first..]);
    // The first key only resumes output that is paused.
    if write().is_ok_and(|count| count > 0 || write().is_ok()) {
        shared.wakes += 1;
    } else if let Some(cancel) = cancel {
        // This ends the reads of other processes too.
        cancel.cancel();
    }
    let deadline = Instant::now() + PATIENCE;
    while shared.is_reading()
        && let Some(left) = deadline.checked_duration_since(Instant::now())
    {
        let _ = LINE_IS_IDLE.timed_wait_guarded(&mut shared, left.as_nanos() as u64);
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Normal,
    Raw,
    /// The console makes the escape sequences.
    RawVt,
}

fn set_mode(handle: HANDLE, mode: Mode) -> sys::Result<()> {
    const COOKED: u32 = w::ENABLE_ECHO_INPUT | w::ENABLE_LINE_INPUT | w::ENABLE_PROCESSED_INPUT;
    const VT: u32 = w::ENABLE_VIRTUAL_TERMINAL_INPUT;

    if !console::is_input(handle) {
        let errno = console::mode(handle).map_or(E::EBADF, |_| E::EINVAL);
        return Err(sys::Error::from_code(errno, Tag::uv_tty_set_mode));
    }
    let error = |err| sys::Error::from_win32(err, Tag::uv_tty_set_mode);
    let input = Input::get(handle).map_err(error)?;
    let flags = match mode {
        Mode::Normal => COOKED,
        Mode::Raw => w::ENABLE_WINDOW_INPUT,
        Mode::RawVt => w::ENABLE_WINDOW_INPUT | VT,
    };
    // No line is begun while the console is in another mode.
    let was_raw = IS_RAW.fetch_or(mode != Mode::Normal, Ordering::SeqCst);
    if mode != Mode::Normal {
        stop_line(input);
    }
    // Other processes change it too.
    let is_set = console::mode(input.raw()).is_ok_and(|it| (it ^ flags) & (COOKED | VT) == 0);
    if !is_set {
        console::set_mode(input.raw(), flags)
            .or_else(|_| console::set_mode(input.raw(), flags & !VT))
            .inspect_err(|_| IS_RAW.store(was_raw, Ordering::SeqCst))
            .map_err(error)?;
    }
    if mode == Mode::Normal && was_raw {
        IS_RAW.store(false, Ordering::SeqCst);
        tell_readers(SHARED.lock());
    }
    Ok(())
}

/// `mode` is a `uv_tty_mode_t`. Returns an error number of Node.js.
#[unsafe(no_mangle)]
extern "C" fn Bun__ttySetMode(fd: c_int, mode: c_int, _state: *mut u8, _drain: c_int) -> c_int {
    let handle = Fd::from_crt(fd).native();
    let result = match mode {
        0 => set_mode(handle, Mode::Normal),
        1 => set_mode(handle, Mode::Raw),
        2 => Err(sys::Error::from_code(E::ENOTSUP, Tag::uv_tty_set_mode)),
        3 => set_mode(handle, Mode::RawVt),
        _ => Err(sys::Error::from_code(E::EINVAL, Tag::uv_tty_set_mode)),
    };
    result.map_or_else(|err| err.js_errno(), |()| 0)
}

#[unsafe(no_mangle)]
extern "C" fn uv_tty_reset_mode() -> c_int {
    if IS_RAW.swap(false, Ordering::SeqCst) {
        bun_core::output::windows_stdio::restore_stdin_mode();
    }
    0
}

// ── source ───────────────────────────────────────────────────────────────

pub(crate) struct Console(Rc<Inner>);

struct Inner {
    endpoint: Endpoint,
    file: File,
    is_input: OnceCell<bool>,
    read: Cell<Option<Request>>,
    /// For the entry in `Shared::readers`.
    news: Cell<Option<Request>>,
    write: Cell<Option<Request>>,
    /// The start of a character that the next write has the rest of.
    incomplete: Cell<Vec<u8>>,
    last_written: Cell<u16>,
}

impl Console {
    pub(super) fn new(port: &Rc<Port>, file: File) -> Console {
        Console(Rc::new(Inner {
            endpoint: Endpoint::new(port),
            file,
            is_input: OnceCell::new(),
            read: Cell::new(None),
            news: Cell::new(None),
            write: Cell::new(None),
            incomplete: Cell::default(),
            last_written: Cell::new(0),
        }))
    }

    pub(super) fn enable_escape_sequences(&self) {
        const VT: u32 = w::ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        let handle = self.fd().native();
        if !console::is_input(handle)
            && let Ok(mode) = console::mode(handle)
            && mode & VT == 0
        {
            let _ = console::set_mode(handle, mode | VT);
        }
    }

    fn fd(&self) -> Fd {
        self.0.file.fd()
    }

    pub(super) fn endpoint(&self) -> &Endpoint {
        &self.0.endpoint
    }

    /// Starts in the next turn of the loop, by when the script may have paused or changed the mode.
    pub(super) fn read(&self, max_len: usize) {
        self.0.endpoint.set_wanted(Some(max_len));
        if !self.0.read.is_some() && !self.0.news.is_some() {
            let start = self.0.on_read(|this| this.continue_reading(false));
            self.0
                .read
                .set(Some(Request::defer(&self.0.endpoint.port, start)));
        }
    }

    pub(super) fn pause(&self) {
        self.0.endpoint.set_wanted(None);
        self.0.read.take();
        if self.0.news.take().is_some()
            && let Ok(input) = Input::get(self.fd().native())
        {
            let mut shared = SHARED.lock();
            (shared.readers).retain(|(address, _)| *address != Rc::as_ptr(&self.0).addr());
            if shared.readers.is_empty() {
                drop(shared);
                stop_line(input);
            }
        }
    }

    pub(super) fn write_now(&self, bytes: &[u8]) -> sys::Result<()> {
        let mut joined = self.0.incomplete.take();
        let bytes = if joined.is_empty() {
            bytes
        } else {
            joined.extend_from_slice(bytes);
            &joined
        };
        let text = match bun_core::handle_oom(bun_core::strings::to_utf16_alloc_maybe_buffered::<
            false,
            false,
        >(bytes))
        {
            Some((text, incomplete, len)) => {
                self.0.incomplete.set(incomplete[..len.into()].to_vec());
                text
            }
            None => bytes.iter().map(|&byte| u16::from(byte)).collect(),
        };
        let text = self.0.with_carriage_returns(text);
        console::write_text(self.fd().native(), &text).map_err(|err| match err {
            Win32Error::INVALID_HANDLE => sys::Error::from_code(E::EPIPE, Tag::write),
            err => sys::Error::from_win32(err, Tag::write),
        })
    }

    pub(super) fn write(&self, payload: Payload) -> sys::Result<()> {
        self.write_now(payload.bytes())?;
        let this = Rc::downgrade(&self.0);
        let report = move || {
            let Some(this) = this.upgrade() else { return };
            this.write.take();
            this.report_write(WriteEvent::Wrote(payload.into_spare()));
        };
        self.0
            .write
            .set(Some(Request::defer(&self.0.endpoint.port, report)));
        self.0.endpoint.set_writing(true);
        Ok(())
    }
}

impl Drop for Console {
    fn drop(&mut self) {
        self.pause();
    }
}

impl HasEndpoint for Inner {
    fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }
}

impl Inner {
    /// Another program may have told the console not to add them.
    fn with_carriage_returns(&self, text: Vec<u16>) -> Vec<u16> {
        const CR: u16 = 0x0D;
        const LF: u16 = 0x0A;
        let mut out = Vec::with_capacity(text.len() + text.len() / 16);
        for unit in text {
            if self.last_written.replace(unit) != CR && unit == LF {
                out.push(CR);
            }
            out.push(unit);
        }
        out
    }

    /// The callback of the request in `read` or `news`.
    fn on_read(self: &Rc<Self>, f: impl FnOnce(Rc<Self>) + 'static) -> impl FnOnce() + 'static {
        let this = Rc::downgrade(self);
        move || {
            if let Some(this) = Weak::upgrade(&this) {
                this.read.take();
                this.news.take();
                f(this);
            }
        }
    }

    fn continue_reading(self: Rc<Self>, has_waited: bool) {
        if !self.endpoint.is_holding()
            && let Some(event) = self.take_or_wait(has_waited)
        {
            self.endpoint.hold(event);
        }
        self.report_read();
    }

    fn take_or_wait(self: &Rc<Self>, has_waited: bool) -> Option<ReadEvent> {
        let error = |errno| Some(ReadEvent::Err(sys::Error::from_code(errno, Tag::recv)));
        let handle = self.file.fd().native();
        if !*self.is_input.get_or_init(|| console::is_input(handle)) {
            return error(E::ENOTCONN);
        }
        let input = match Input::get(handle) {
            Ok(input) => input,
            Err(err) => return Some(ReadEvent::Err(sys::Error::from_win32(err, Tag::recv))),
        };
        let (mut shared, address) = (SHARED.lock(), Rc::as_ptr(self).addr());
        shared.readers.retain(|reader| reader.0 != address);
        let reads_keys = IS_RAW.load(Ordering::SeqCst) && !shared.is_reading();
        if reads_keys && has_waited {
            shared.read_keys(input);
        }
        if !shared.text.is_empty() {
            let len = (shared.text.len()).min(self.endpoint.wanted().unwrap_or(usize::MAX));
            let rest = shared.text.split_off(len);
            return Some(ReadEvent::Data(core::mem::replace(&mut shared.text, rest)));
        }
        if let Some(end) = shared.end.take() {
            return Some(end);
        }

        let done = || self.on_read(|this| this.continue_reading(true));
        if reads_keys {
            match Request::wait(&self.endpoint.port, input.handle.as_handle(), done()) {
                Ok(request) => self.read.set(Some(request)),
                Err(_) => return error(E::ENOMEM),
            }
        } else if let Line::Idle = shared.line {
            blocking::spawn(|| read_line(input));
            shared.line = Line::Starting;
        }
        let done = done();
        let (request, remote) = Request::remote(&self.endpoint.port, |()| done());
        shared.readers.push((address, remote));
        self.news.set(Some(request));
        None
    }
}
