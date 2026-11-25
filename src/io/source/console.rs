use core::cell::{Cell, OnceCell};
use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, Ordering};
use std::os::windows::io::{AsHandle as _, AsRawHandle as _, OwnedHandle};
use std::rc::{Rc, Weak};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use bun_iocp::blocking::{self, CancelToken, ConcurrencyGate};
use bun_iocp::{Completer, Port, Request};
use bun_ptr::OptionCellExt as _;
use bun_sys::windows::{self as w, HANDLE, Win32Error, console};
use bun_sys::windows_format::key_input::{self, InputRecord, Utf16Decoder};
use bun_sys::{self as sys, E, Fd, File, Tag};
use bun_threading::guarded::GuardedLock;
use bun_threading::{Condition, Guarded, Mutex};

use super::Payload;
use super::state::{HasSourceState, SourceState};
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

const CR: u16 = 0x0D;
const LF: u16 = 0x0A;

// ── input ────────────────────────────────────────────────────────────────

/// One per process: every handle to the console's input reads from the same input buffer.
struct Input {
    handle: OwnedHandle,
    /// Holds `watch_line_reads` back until the thread in `read_line` blocks.
    watcher_gate: ConcurrencyGate,
}

impl Input {
    fn get(fallback: HANDLE) -> Result<&'static Input, Win32Error> {
        static INPUT: OnceLock<Input> = OnceLock::new();
        if let Some(input) = INPUT.get() {
            return Ok(input);
        }
        let input = Input {
            handle: open_input().or_else(|_| w::duplicate_handle(fallback))?,
            watcher_gate: ConcurrencyGate::new()?,
        };
        Ok(INPUT.get_or_init(|| input))
    }

    fn raw(&self) -> HANDLE {
        self.handle.as_raw_handle()
    }

    fn is_signaled(&self) -> bool {
        w::kernel32::WaitForSingleObject(self.raw(), 0) == w::WAIT_OBJECT_0
    }

    /// Writing a record makes the console hand queued input to a pending read, and reading the last record resets the handle.
    fn write_noop_record(&self) -> Result<usize, Win32Error> {
        let record = InputRecord {
            event_type: key_input::MENU_EVENT,
            ..Default::default()
        };
        console::write_records(self.raw(), &[record])
    }

    /// Skips the leading keys without a character in VT input mode, where they become text.
    fn write_keys(&self, keys: &[InputRecord]) -> Result<usize, Win32Error> {
        let is_vt_input = console::mode(self.raw())
            .is_ok_and(|mode| mode & w::ENABLE_VIRTUAL_TERMINAL_INPUT != 0);
        let is_skipped = |key: &&InputRecord| is_vt_input && key.character == 0;
        console::write_records(
            self.raw(),
            &keys[keys.iter().take_while(is_skipped).count()..],
        )
    }

    /// Popups of older consoles take one key per write. Returns whether a read of any process has taken all input.
    fn deliver_queued_keys(&self) -> bool {
        const MAX_POPUP_KEYS_PER_WRITE: usize = 2;
        (0..MAX_POPUP_KEYS_PER_WRITE).any(|_| {
            self.write_noop_record().is_ok() && console::queued_record_count(self.raw()) == Ok(0)
        })
    }

    /// The popups of F7 and F9 take every key until Escape or Enter.
    fn is_popup_open(&self) -> bool {
        const LINE: u32 = w::ENABLE_LINE_INPUT;
        const VT: u32 = w::ENABLE_VIRTUAL_TERMINAL_INPUT;
        console::mode(self.raw()).is_ok_and(|mode| mode & (LINE | VT) == LINE)
            && console::open(bun_core::wstr!("CONOUT$"))
                .and_then(|output| console::has_popup(output.as_raw_handle()))
                == Ok(true)
    }
}

fn open_input() -> Result<OwnedHandle, Win32Error> {
    console::open(bun_core::wstr!("CONIN$"))
}

static IS_RAW: AtomicBool = AtomicBool::new(false);

enum LineReadState {
    Idle,
    Starting,
    /// The console keeps a cancelled read going until its handle is closed, so only a read on a private handle has a token.
    Reading(Option<CancelToken>),
}

struct Shared {
    line_state: LineReadState,
    line_read_count: usize,
    has_watcher_thread: bool,
    /// Notified when the line read ends or raw mode is left. Keyed by the address of the reader's `Inner`.
    readers: Vec<(usize, Completer<()>)>,
    buffered_text: Vec<u8>,
    end_event: Option<ReadEvent>,
    decoder: Utf16Decoder,
    /// `WAKE_CHAR`s written to the input buffer and not read back yet.
    pending_wake_count: usize,
    /// Private input handle kept for the next line read.
    spare_line_handle: Option<OwnedHandle>,
}

static SHARED: Guarded<Shared> = Guarded::new(Shared {
    line_state: LineReadState::Idle,
    line_read_count: 0,
    has_watcher_thread: false,
    readers: Vec::new(),
    buffered_text: Vec::new(),
    end_event: None,
    decoder: Utf16Decoder::new(),
    pending_wake_count: 0,
    spare_line_handle: None,
});
static LINE_READ_DONE: Condition = Condition::new();

/// Ends a line read without an echo or a history entry.
const WAKE_CHAR: u16 = 0x1E;
const VK_ESCAPE: u16 = 0x1B;
const VK_END: u16 = 0x23;
const VK_F4: u16 = 0x73;
const VK_NONAME: u16 = 0xFC;

/// Has no scan code, unlike a real key press.
fn make_key_record(virtual_key: u16, character: u16) -> InputRecord {
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
    fn is_reading_line(&self) -> bool {
        matches!(self.line_state, LineReadState::Reading(_))
    }

    fn try_consume_wake_char(&mut self, character: u16) -> bool {
        let is_wake = character == WAKE_CHAR && self.pending_wake_count > 0;
        self.pending_wake_count -= usize::from(is_wake);
        is_wake
    }

    fn record_error(&mut self, err: Win32Error) {
        self.end_event = Some(match err {
            Win32Error::BROKEN_PIPE | Win32Error::NO_DATA | Win32Error::PIPE_NOT_CONNECTED => {
                ReadEvent::Eof
            }
            err => ReadEvent::Err(sys::Error::from_win32(err, Tag::recv)),
        });
    }

    fn read_keys(&mut self, input: &Input) {
        const BATCH_SIZE: usize = 256;
        const MAX_BATCHES: usize = 32;
        /// Pasted text is delivered in chunks of a few KiB, as from a terminal.
        const CHUNK_THRESHOLD: usize = 4096;
        let mut records = [InputRecord::default(); BATCH_SIZE];
        let mut is_resized = false;
        for _ in 0..MAX_BATCHES {
            let records = match console::read_records(input.raw(), &mut records) {
                Ok(records) => records,
                Err(err) => return self.record_error(err),
            };
            // Changing the screen buffer empties the input buffer but leaves the handle signaled.
            if records.is_empty() && input.is_signaled() {
                let _ = input.write_noop_record();
            }
            for record in records {
                is_resized |= record.event_type == key_input::WINDOW_BUFFER_SIZE_EVENT;
                let is_synthetic_key = self.pending_wake_count > 0
                    && [VK_END, VK_F4]
                        .map(|key| make_key_record(key, 0))
                        .contains(record);
                if !is_synthetic_key
                    && !(record.is_key_input() && self.try_consume_wake_char(record.character))
                {
                    key_input::translate(record, &mut self.decoder, &mut self.buffered_text);
                }
            }
            if records.len() < BATCH_SIZE || self.buffered_text.len() >= CHUNK_THRESHOLD {
                break;
            }
        }
        if is_resized {
            crate::console_signals::check_window_size();
        }
    }

    /// For wake keys that arrived after the read had ended.
    fn remove_wake_keys(&mut self, input: &Input, keys: [InputRecord; 3]) {
        if !matches!(console::queued_record_count(input.raw()), Ok(1..=3)) {
            return;
        }
        let mut records = keys;
        match console::read_records(input.raw(), &mut records) {
            Ok([]) | Err(_) => {}
            Ok(records) if keys.ends_with(records) => self.pending_wake_count -= 1,
            Ok(records) => drop(console::write_records(input.raw(), records)),
        }
    }

    fn add_line(&mut self, line: &[u16]) {
        const CTRL_Z: u16 = 0x1A;
        if let [CTRL_Z, .., LF] = line {
            self.end_event = Some(ReadEvent::Eof);
            return;
        }
        for &code_unit in line {
            if !self.try_consume_wake_char(code_unit) {
                self.decoder.push(code_unit, &mut self.buffered_text);
            }
        }
    }
}

/// Before microsoft/terminal#18816, a key that arrives while the console sets up a read is not delivered until the next record.
fn watch_line_reads(input: &Input) {
    let mut last_signaled_read = None;
    loop {
        input.watcher_gate.wait();
        let shared = SHARED.lock();
        let current_read = (shared.is_reading_line() && !shared.readers.is_empty())
            .then_some(shared.line_read_count);
        drop(shared);
        if current_read.is_none()
            || (current_read == last_signaled_read && input.write_noop_record().is_err())
        {
            continue;
        }
        // The console handles requests in order, so it has seen the read once this round trip returns.
        if !console::is_input(input.raw()) {
            continue;
        }
        input.watcher_gate.post_on_signal(input.handle.as_handle());
        let is_signaled = input.is_signaled();
        last_signaled_read = current_read.filter(|_| is_signaled);
        if !is_signaled {
            // A line read discards `WINDOW_BUFFER_SIZE_EVENT` records.
            crate::console_signals::check_window_size();
        }
    }
}

/// Without line input a full buffer can be all there is, and without processed input a line ends with CR.
fn has_line_remainder(handle: HANDLE, text: &[u16]) -> bool {
    console::mode(handle).is_ok_and(|mode| {
        mode & w::ENABLE_LINE_INPUT != 0
            && (mode & w::ENABLE_PROCESSED_INPUT != 0 || text.last() != Some(&CR))
    })
}

fn read_line(input: &'static Input) {
    /// Older consoles stop accepting keys once the buffer is full.
    const BUFFER_LEN: usize = 8192;
    let mut buffer = vec![0; BUFFER_LEN];
    let mut shared = SHARED.lock();
    if !shared.readers.is_empty() && !IS_RAW.load(Ordering::SeqCst) {
        let spare_handle = shared.spare_line_handle.take();
        let is_spare = spare_handle.is_some();
        let private_handle = spare_handle.or_else(|| open_input().ok());
        let cancel_token = CancelToken::default();
        shared.has_watcher_thread =
            shared.has_watcher_thread || blocking::try_spawn_dedicated(|| watch_line_reads(input));
        input.watcher_gate.post();
        shared.line_read_count += 1;
        shared.line_state =
            LineReadState::Reading(private_handle.is_some().then(|| cancel_token.clone()));
        drop(shared);

        let handle = private_handle
            .as_ref()
            .unwrap_or(&input.handle)
            .as_raw_handle();
        shared = loop {
            let line = cancel_token.run(|| console::read_text(handle, &mut buffer, WAKE_CHAR));
            let line = line.unwrap_or(Ok(&[]));
            let mut shared = SHARED.lock();
            match line {
                Ok(line) => shared.add_line(line),
                // Cancelled, or the console failed to process a character.
                Err(Win32Error::OPERATION_ABORTED | Win32Error::INVALID_PARAMETER) => {}
                // The process has moved to another console.
                Err(Win32Error::INVALID_HANDLE) if is_spare => {}
                Err(err) => shared.record_error(err),
            }
            // The rest of a line longer than `buffer` has already left the input buffer.
            let is_partial_line = |line: &[u16]| {
                line.len() == BUFFER_LEN
                    && !matches!(line, [.., CR, LF] | [.., WAKE_CHAR])
                    && (shared.pending_wake_count > 0 || has_line_remainder(handle, line))
            };
            if !line.is_ok_and(is_partial_line) {
                shared.spare_line_handle =
                    private_handle.filter(|_| line.is_ok() && !cancel_token.is_cancelled());
                break shared;
            }
        };
    }
    shared.line_state = LineReadState::Idle;
    LINE_READ_DONE.notify_all();
    notify_readers(shared);
}

fn notify_readers(mut shared: GuardedLock<'_, Shared, Mutex>) {
    let readers = core::mem::take(&mut shared.readers);
    drop(shared);
    // Newest first: that reader gets the line.
    for (_, completer) in readers.into_iter().rev() {
        completer.complete(());
    }
}

/// Whatever the read returns is buffered for the next reader, even if the read outlasts the timeout.
fn stop_line_read(input: &Input) {
    let mut shared = SHARED.lock();
    // A blocked read leaves nothing queued. One that ends on typed-ahead input would leave the keys to the next program.
    if shared.is_reading_line()
        && console::queued_record_count(input.raw()).is_ok_and(|count| count > 0)
        && wait_for_line_read(&mut shared)
    {
        return;
    }
    let LineReadState::Reading(cancel_token) = &shared.line_state else {
        return;
    };
    let [spare, end, f4, escape] =
        [VK_NONAME, VK_END, VK_F4, VK_ESCAPE].map(|key| make_key_record(key, 0));
    let wake = make_key_record(0, WAKE_CHAR);
    // While output is paused, the first key only resumes it. `WAKE_CHAR` replaces the text after the cursor, so End goes first.
    let write_wake_keys = || input.write_keys(&[spare, end, wake]);
    let is_written = write_wake_keys().is_ok_and(|count| count > 0 || write_wake_keys().is_ok());
    let earlier_wake_count = shared.pending_wake_count;
    if is_written {
        shared.pending_wake_count += 1;
    } else if let Some(cancel_token) = cancel_token {
        // Cancelling also ends the console reads of other processes.
        cancel_token.cancel();
    }
    if wait_for_line_read(&mut shared) || !is_written {
        if shared.pending_wake_count > earlier_wake_count && !shared.is_reading_line() {
            shared.remove_wake_keys(input, [spare, end, wake]);
        }
        return;
    }
    if input.deliver_queued_keys() {
        // Without a popup, the read of another process has taken the keys.
        if !input.is_popup_open() {
            return;
        }
        // Escape clears the line if no popup is open, so F4 opens one. Older consoles close stacked popups one at a time.
        for _ in 0..2 {
            let _ = input.write_keys(&[spare, f4, escape]);
            input.deliver_queued_keys();
        }
        let _ = write_wake_keys();
    }
    wait_for_line_read(&mut shared);
}

/// Returns `false` on timeout.
fn wait_for_line_read(shared: &mut GuardedLock<'_, Shared, Mutex>) -> bool {
    const TIMEOUT: Duration = Duration::from_millis(50);
    let deadline = Instant::now() + TIMEOUT;
    let line_read_count = shared.line_read_count;
    while shared.is_reading_line() && shared.line_read_count == line_read_count {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return false;
        };
        let _ = LINE_READ_DONE.timed_wait_guarded(shared, remaining.as_nanos() as u64);
    }
    true
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Normal,
    Raw,
    /// The console generates the escape sequences itself.
    RawVt,
}

fn set_mode(handle: HANDLE, mode: Mode) -> sys::Result<()> {
    const COOKED: u32 = w::ENABLE_ECHO_INPUT | w::ENABLE_LINE_INPUT | w::ENABLE_PROCESSED_INPUT;
    const VT: u32 = w::ENABLE_VIRTUAL_TERMINAL_INPUT;

    if !console::is_input(handle) {
        let errno = console::mode(handle).map_or(E::EBADF, |_| E::EINVAL);
        return Err(sys::Error::from_code(errno, Tag::uv_tty_set_mode));
    }
    let map_error = |err| sys::Error::from_win32(err, Tag::uv_tty_set_mode);
    let input = Input::get(handle).map_err(map_error)?;
    let flags = match mode {
        Mode::Normal => COOKED,
        Mode::Raw => w::ENABLE_WINDOW_INPUT,
        Mode::RawVt => w::ENABLE_WINDOW_INPUT | VT,
    };
    // Set before the console leaves normal mode and cleared after it is back, so that no line read starts in raw mode.
    let was_raw = IS_RAW.fetch_or(mode != Mode::Normal, Ordering::SeqCst);
    if mode != Mode::Normal {
        stop_line_read(input);
    } else if !was_raw {
        return Ok(());
    }
    // Other processes attached to the console change its mode too.
    let is_set =
        console::mode(input.raw()).is_ok_and(|current| (current ^ flags) & (COOKED | VT) == 0);
    if !is_set {
        // The mode is restored through `handle` at exit, so it must have the access to change it.
        console::set_mode(handle, flags)
            .or_else(|_| console::set_mode(handle, flags & !VT))
            .inspect_err(|_| IS_RAW.store(was_raw, Ordering::SeqCst))
            .map_err(map_error)?;
    }
    if mode == Mode::Normal {
        IS_RAW.store(false, Ordering::SeqCst);
        notify_readers(SHARED.lock());
    }
    Ok(())
}

/// `mode` is a `uv_tty_mode_t`. Returns 0 or a libuv error code.
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
    state: SourceState,
    file: File,
    is_input: OnceCell<bool>,
    inflight_read: Cell<Option<Request>>,
    /// Completed through this reader's entry in `Shared::readers`.
    notification: Cell<Option<Request>>,
    inflight_write: Cell<Option<Request>>,
    /// Leading bytes of a UTF-8 sequence that is split across writes.
    incomplete_utf8: Cell<Vec<u8>>,
    last_written_unit: Cell<u16>,
}

impl Console {
    pub(super) fn new(port: &Rc<Port>, file: File) -> Console {
        Console(Rc::new(Inner {
            state: SourceState::new(port),
            file,
            is_input: OnceCell::new(),
            inflight_read: Cell::new(None),
            notification: Cell::new(None),
            inflight_write: Cell::new(None),
            incomplete_utf8: Cell::default(),
            last_written_unit: Cell::new(0),
        }))
    }

    pub(super) fn enable_escape_sequences(&self) {
        const VT: u32 = w::ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        let handle = self.fd().native();
        if let Ok(mode) = console::mode(handle)
            && mode & VT == 0
            && !console::is_input(handle)
        {
            let _ = console::set_mode(handle, mode | VT);
        }
    }

    fn fd(&self) -> Fd {
        self.0.file.fd()
    }

    pub(super) fn state(&self) -> &SourceState {
        &self.0.state
    }

    /// Starts in the next loop iteration, by which time JS may have paused or changed the mode.
    pub(super) fn read(&self, max_len: usize) {
        self.0.state.set_read_limit(Some(max_len));
        if self.0.inflight_read.is_none() && self.0.notification.is_none() {
            let callback = self.0.make_read_callback(|this| this.process_read(false));
            self.0
                .inflight_read
                .set(Some(Request::defer(&self.0.state.port, callback)));
        }
    }

    pub(super) fn pause(&self) {
        self.0.state.set_read_limit(None);
        self.0.inflight_read.take();
        if self.0.notification.take().is_some()
            && let Ok(input) = Input::get(self.fd().native())
        {
            let mut shared = SHARED.lock();
            shared
                .readers
                .retain(|(address, _)| *address != Rc::as_ptr(&self.0).addr());
            if shared.readers.is_empty() {
                drop(shared);
                stop_line_read(input);
            }
        }
    }

    pub(super) fn write_sync(&self, bytes: &[u8]) -> sys::Result<()> {
        let mut joined = self.0.incomplete_utf8.take();
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
            Some((text, incomplete, incomplete_len)) => {
                self.0
                    .incomplete_utf8
                    .set(incomplete[..incomplete_len.into()].to_vec());
                text
            }
            None => bytes.iter().map(|&byte| u16::from(byte)).collect(),
        };
        let text = self.0.insert_carriage_returns(text);
        console::write_text(self.fd().native(), &text).map_err(|err| match err {
            Win32Error::INVALID_HANDLE => sys::Error::from_code(E::EPIPE, Tag::write),
            err => sys::Error::from_win32(err, Tag::write),
        })
    }

    pub(super) fn write(&self, payload: Payload) -> sys::Result<()> {
        self.write_sync(payload.as_bytes())?;
        let this = Rc::downgrade(&self.0);
        let callback = move || {
            let Some(this) = this.upgrade() else { return };
            this.inflight_write.take();
            this.report_write(WriteEvent::Wrote(payload.into_spare_buffer()));
        };
        self.0
            .inflight_write
            .set(Some(Request::defer(&self.0.state.port, callback)));
        self.0.state.set_writing(true);
        Ok(())
    }
}

impl Drop for Console {
    fn drop(&mut self) {
        self.pause();
    }
}

impl HasSourceState for Inner {
    fn state(&self) -> &SourceState {
        &self.state
    }
}

impl Inner {
    /// Another process may have turned off the console's own LF to CRLF translation.
    fn insert_carriage_returns(&self, text: Vec<u16>) -> Vec<u16> {
        let mut out = Vec::with_capacity(text.len() + text.len() / 16);
        for code_unit in text {
            if self.last_written_unit.replace(code_unit) != CR && code_unit == LF {
                out.push(CR);
            }
            out.push(code_unit);
        }
        out
    }

    fn make_read_callback(
        self: &Rc<Self>,
        f: impl FnOnce(Rc<Self>) + 'static,
    ) -> impl FnOnce() + 'static {
        let this = Rc::downgrade(self);
        move || {
            if let Some(this) = Weak::upgrade(&this) {
                this.inflight_read.take();
                this.notification.take();
                f(this);
            }
        }
    }

    fn process_read(self: Rc<Self>, has_waited: bool) {
        if !self.state.has_buffered_event()
            && let Some(event) = self.poll_input(has_waited)
        {
            self.state.buffer_event(event);
        }
        self.report_read();
    }

    /// On `None`, `process_read` runs again when there may be input.
    fn poll_input(self: &Rc<Self>, has_waited: bool) -> Option<ReadEvent> {
        let make_error_event =
            |errno| Some(ReadEvent::Err(sys::Error::from_code(errno, Tag::recv)));
        let handle = self.file.fd().native();
        if !*self.is_input.get_or_init(|| console::is_input(handle)) {
            return make_error_event(E::ENOTCONN);
        }
        let input = match Input::get(handle) {
            Ok(input) => input,
            Err(err) => return Some(ReadEvent::Err(sys::Error::from_win32(err, Tag::recv))),
        };
        let mut shared = SHARED.lock();
        let address = Rc::as_ptr(self).addr();
        shared.readers.retain(|reader| reader.0 != address);
        let should_read_keys = IS_RAW.load(Ordering::SeqCst) && !shared.is_reading_line();
        if should_read_keys && has_waited {
            shared.read_keys(input);
        }
        if !shared.buffered_text.is_empty() {
            let len = shared
                .buffered_text
                .len()
                .min(self.state.read_limit().unwrap_or(usize::MAX));
            let remainder = shared.buffered_text.split_off(len);
            return Some(ReadEvent::Data(core::mem::replace(
                &mut shared.buffered_text,
                remainder,
            )));
        }
        if let Some(end_event) = shared.end_event.take() {
            return Some(end_event);
        }

        let make_callback = || self.make_read_callback(|this| this.process_read(true));
        if should_read_keys {
            match Request::wait(&self.state.port, input.handle.as_handle(), make_callback()) {
                Ok(request) => self.inflight_read.set(Some(request)),
                Err(_) => return make_error_event(E::ENOMEM),
            }
        } else if let LineReadState::Idle = shared.line_state {
            blocking::spawn(|| read_line(input));
            shared.line_state = LineReadState::Starting;
        }
        let callback = make_callback();
        let (request, completer) = Request::with_completer(&self.state.port, |()| callback());
        shared.readers.push((address, completer));
        self.notification.set(Some(request));
        None
    }
}
