//! A console handle driven by the loop.
//!
//! Console handles cannot do overlapped I/O, but an input handle is signalled
//! while its queue holds records. In raw mode the loop waits on the handle and
//! reads the records itself; in line mode the console only hands out whole
//! edited lines through a blocking `ReadConsoleW`, which runs on a helper
//! thread. Output is synchronous.
//!
//! The input mode belongs to the console, not to a handle, so it is
//! process-wide state here too: every reader picks its mechanism from it when
//! it arms, and a mode change wakes the readers so they re-arm.

use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicU32, Ordering};
use std::sync::Arc;

use bun_sys::{self as sys, E, Fd, FdExt as _, Tag};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{self, Op, OverlappedEntry, Wait};

use super::pipe::ReadEvent;
use super::sys as win;
use super::sys::{HANDLE, INVALID_HANDLE_VALUE, Win32Error};
use super::tty_input::{self, RawInputState};
use super::tty_output::{self, OutputState};
use super::{Callback, Link, Port};

/// How console input is delivered.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Mode {
    /// Whole lines, edited and echoed by the console.
    Normal = 0,
    /// Every key as it is pressed, translated to VT sequences here.
    Raw = 1,
    /// As `Raw`, with the console doing the VT translation when it can.
    RawVt = 2,
}

static INPUT_MODE: AtomicU8 = AtomicU8::new(Mode::Normal as u8);
/// The console's input mode before the first change; `u32::MAX` until then.
static ORIGINAL_INPUT_MODE: AtomicU32 = AtomicU32::new(u32::MAX);
static ORIGINAL_INPUT_HANDLE: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static RAW_WAITERS: AtomicU32 = AtomicU32::new(0);
static LINE_READERS: AtomicU32 = AtomicU32::new(0);
static ON_RESIZE: AtomicPtr<()> = AtomicPtr::new(ptr::null_mut());

/// Ends a blocked line read without touching the screen or the typed text:
/// the console returns from `ReadConsoleW` when this control character is
/// entered (`dwCtrlWakeupMask`), with the character last in the buffer.
const WAKE_CHAR: u16 = 0x1d;
const WAKE_VIRTUAL_KEY: u16 = 0xDD;
const WAKE_SCAN_CODE: u16 = 0x1B;

/// UTF-16 units asked of one line read. Converted to UTF-8 they stay within
/// the 8 KiB the console handles well.
const LINE_READ_CHARS: usize = (8192 - 1) / 3;

fn current_mode() -> Mode {
    match INPUT_MODE.load(Ordering::Acquire) {
        1 => Mode::Raw,
        2 => Mode::RawVt,
        _ => Mode::Normal,
    }
}

/// Set the input mode of the console `input` belongs to. Readers on any thread
/// switch between the line and raw mechanisms on their own.
pub fn set_console_mode(input: HANDLE, mode: Mode) -> sys::Result<()> {
    let fail = |err: Win32Error| sys::Error::from_win32(err, Tag::uv_tty_set_mode);
    {
        // Console writes must not interleave with the mode change.
        let _output = tty_output::lock_output();
        let mut previous: u32 = 0;
        // SAFETY: `previous` is a live local.
        if unsafe { win::GetConsoleMode(input, &raw mut previous) } == 0 {
            return Err(fail(win::last_error()));
        }
        if ORIGINAL_INPUT_MODE
            .compare_exchange(u32::MAX, previous, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            ORIGINAL_INPUT_HANDLE.store(input, Ordering::Release);
            bun_core::add_exit_callback(Bun__Windows__resetConsoleMode);
        }
        let flags = match mode {
            Mode::Normal => {
                win::ENABLE_ECHO_INPUT | win::ENABLE_LINE_INPUT | win::ENABLE_PROCESSED_INPUT
            }
            Mode::Raw => win::ENABLE_WINDOW_INPUT,
            Mode::RawVt => win::ENABLE_WINDOW_INPUT | win::ENABLE_VIRTUAL_TERMINAL_INPUT,
        };
        // SAFETY: plain Win32 calls on the caller's console handle.
        unsafe {
            if win::SetConsoleMode(input, flags) == 0 {
                // A console without VT input: the key table does the translation.
                if mode != Mode::RawVt || win::SetConsoleMode(input, win::ENABLE_WINDOW_INPUT) == 0
                {
                    return Err(fail(win::last_error()));
                }
            }
        }
    }
    let was = INPUT_MODE.swap(mode as u8, Ordering::AcqRel);
    if (was == Mode::Normal as u8) != (mode == Mode::Normal) {
        wake_readers(input);
    }
    Ok(())
}

/// Put back the input mode the console had before [`set_console_mode`] first
/// changed it. The console keeps its mode after the process is gone, so this
/// runs on exit.
pub fn reset_console_mode() {
    let original = ORIGINAL_INPUT_MODE.load(Ordering::Acquire);
    if original == u32::MAX {
        return;
    }
    let handle = ORIGINAL_INPUT_HANDLE.load(Ordering::Acquire);
    // SAFETY: plain Win32 calls. The handle the mode was first changed through
    // may have been closed since (the call then fails harmlessly); the console
    // itself is still reachable by name.
    unsafe {
        if win::SetConsoleMode(handle, original) != 0 {
            return;
        }
        let console = win::CreateFileW(
            bun_core::w!("CONIN$\0").as_ptr(),
            win::GENERIC_READ | win::GENERIC_WRITE,
            bun_sys::windows::FILE_SHARE_READ | bun_sys::windows::FILE_SHARE_WRITE,
            ptr::null_mut(),
            win::OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );
        if console != INVALID_HANDLE_VALUE {
            win::SetConsoleMode(console, original);
            win::CloseHandle(console);
        }
    }
}

/// [`set_console_mode`] for C++, in libuv's terms: `mode` is a `uv_tty_mode_t`
/// (0 normal, 1 raw, 2 "IO", 3 raw with VT input) and the result is 0 or a
/// negative `UV_E*`.
#[unsafe(no_mangle)]
extern "C" fn Bun__Windows__setConsoleMode(
    input: HANDLE,
    mode: core::ffi::c_int,
) -> core::ffi::c_int {
    let mode = match mode {
        0 => Mode::Normal,
        1 => Mode::Raw,
        2 => return bun_errno::uv_codes::UV_ENOTSUP,
        3 => Mode::RawVt,
        _ => return bun_errno::uv_codes::UV_EINVAL,
    };
    match set_console_mode(input, mode) {
        Ok(()) => 0,
        Err(err) => bun_errno::uv_codes::e_discriminant_to_uv(err.errno)
            .unwrap_or_else(|| core::ffi::c_int::from(err.errno).wrapping_neg()),
    }
}

/// [`reset_console_mode`] for C++.
#[unsafe(no_mangle)]
extern "C" fn Bun__Windows__resetConsoleMode() {
    reset_console_mode();
}

/// `listener` runs on a reading loop's thread when the console reports that its
/// window changed size. Only a raw-mode reader sees those reports.
pub fn set_resize_listener(listener: Option<fn()>) {
    ON_RESIZE.store(
        listener.map_or(ptr::null_mut(), |f| f as *mut ()),
        Ordering::Release,
    );
}

/// Get every reader out of the mechanism that the mode change made wrong.
fn wake_readers(input: HANDLE) {
    // SAFETY: an all-zero `INPUT_RECORD` is a valid (empty) record.
    let mut records: [win::INPUT_RECORD; 2] = unsafe { bun_core::ffi::zeroed_unchecked() };
    let mut count = 0usize;
    if RAW_WAITERS.load(Ordering::Acquire) > 0 {
        // Any record signals the handle; this one means nothing to anybody.
        records[count].EventType = win::FOCUS_EVENT;
        count += 1;
    }
    if LINE_READERS.load(Ordering::Acquire) > 0 {
        records[count] = wake_record();
        count += 1;
    }
    if count == 0 {
        return;
    }
    let mut written: u32 = 0;
    // SAFETY: `records[..count]` is initialized; `written` is a live local.
    unsafe { win::WriteConsoleInputW(input, records.as_ptr(), count as u32, &raw mut written) };
}

fn wake_record() -> win::INPUT_RECORD {
    // SAFETY: an all-zero `INPUT_RECORD` is a valid (empty) record.
    let mut record: win::INPUT_RECORD = unsafe { bun_core::ffi::zeroed_unchecked() };
    record.EventType = win::KEY_EVENT;
    record.Event.KeyEvent = bun_windows_sys::KEY_EVENT_RECORD {
        bKeyDown: 1,
        wRepeatCount: 1,
        wVirtualKeyCode: WAKE_VIRTUAL_KEY,
        wVirtualScanCode: WAKE_SCAN_CODE,
        uChar: bun_windows_sys::KEY_EVENT_RECORD_uChar {
            UnicodeChar: WAKE_CHAR,
        },
        dwControlKeyState: win::LEFT_CTRL_PRESSED,
    };
    record
}

/// Whether `handle` is a console (input or screen buffer).
pub fn is_console(handle: HANDLE) -> bool {
    let mut mode: u32 = 0;
    // SAFETY: `mode` is a live local.
    unsafe { win::GetConsoleMode(handle, &raw mut mode) != 0 }
}

type ReadCallback = unsafe fn(*const (), *mut c_void, ReadEvent<'_>);

#[derive(Clone, Copy)]
struct Reader {
    ctx: *mut c_void,
    f: *const (),
    call: ReadCallback,
}

/// The owner's handle to a console. Dropping it closes without telling anyone.
pub struct Tty {
    inner: NonNull<Inner>,
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    struct Flags: u8 {
        const READABLE      = 1 << 0;
        const READING       = 1 << 1;
        const REFD          = 1 << 2;
        const KEEPING_ALIVE = 1 << 3;
        const CLOSING       = 1 << 4;
        const DETACHED      = 1 << 5;
        const OWNER_GONE    = 1 << 6;
        const SILENT        = 1 << 7;
    }
}

#[repr(C)]
struct Inner {
    link: Link,
    handle: HANDLE,
    close_fd: Option<Fd>,
    /// `handle` is this tty's own duplicate of a standard handle.
    duplicated: bool,
    flags: Flags,

    reader: Option<Reader>,
    raw_state: RawInputState,
    raw_op: *mut RawOp,
    line_op: *mut LineOp,
    /// A line that arrived while the owner was not reading.
    held: Vec<u8>,
    held_error: Option<Win32Error>,

    output: OutputState,
    writes_in_flight: u32,

    pending: u32,
    pins: u32,
}

#[repr(C)]
struct RawOp {
    op: Op,
    tty: *mut Inner,
    wait: *mut Wait,
    armed: bool,
    buf: Vec<u8>,
}

#[repr(C)]
struct LineOp {
    op: Op,
    tty: *mut Inner,
    handle: HANDLE,
    port: Option<Arc<Port>>,
    in_flight: bool,
    /// The owner wants this read over: it is closing (`cancel`) or stopped
    /// reading (`stop`). A mode change is seen through `INPUT_MODE` instead.
    cancel: AtomicBool,
    stop: AtomicBool,
    /// Held to set `cancel`/`stop` and look at `in_call`, and by the reader to
    /// look at them and set `in_call`: the wake key is only typed for a
    /// `ReadConsoleW` that will take it out of the queue again.
    wake_lock: bun_threading::Mutex,
    in_call: AtomicBool,
    /// `chars[..carry]` is what the user had typed when a read was woken. The
    /// console took it out of its line editor, so the next read hands it back
    /// through `nInitialChars`.
    chars: Vec<u16>,
    carry: usize,
    bytes: Vec<u8>,
    error: u32,
    woken: bool,
}

/// A packet that carries no I/O: a write's completion or held input.
#[repr(C)]
struct PostedOp {
    op: Op,
    tty: *mut Inner,
    write: Option<(Callback<sys::Result<usize>>, sys::Result<usize>)>,
}

impl Tty {
    /// Take over the console handle behind `fd`. Standard handles are
    /// duplicated and the original is left alone; any other `fd` is closed
    /// with the tty when `close_fd` is set. On `Err` the caller still owns `fd`.
    pub fn open(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<Tty> {
        let original = fd.native();
        let (handle, close_with) = if fd.stdio_tag().is_some() {
            let mut dup: HANDLE = ptr::null_mut();
            // SAFETY: both process handles are the pseudo-handle; `original`
            // is the caller's open HANDLE.
            let ok = unsafe {
                win::DuplicateHandle(
                    win::GetCurrentProcess(),
                    original,
                    win::GetCurrentProcess(),
                    &raw mut dup,
                    0,
                    0,
                    win::DUPLICATE_SAME_ACCESS,
                )
            };
            if ok == 0 {
                return Err(sys::Error::from_win32(win::last_error(), Tag::dup).with_fd(fd));
            }
            (dup, Some(Fd::from_system(dup)))
        } else {
            (original, close_fd.then_some(fd))
        };

        let mut events: u32 = 0;
        // SAFETY: `events` is a live local. Only an input handle answers this.
        let readable = unsafe { win::GetNumberOfConsoleInputEvents(handle, &raw mut events) } != 0;
        if !readable && let Err(code) = tty_output::init_output_handle(handle) {
            if handle != original {
                // SAFETY: `handle` is the duplicate made above.
                unsafe { win::CloseHandle(handle) };
            }
            return Err(sys::Error::from_win32(Win32Error::from_u32(code), Tag::open).with_fd(fd));
        }

        let inner = bun_core::heap::into_raw(Box::new(Inner {
            link: Link::new(loop_, Inner::shut),
            handle,
            close_fd: close_with,
            duplicated: handle != original,
            flags: if readable {
                Flags::REFD | Flags::READABLE
            } else {
                Flags::REFD
            },
            reader: None,
            raw_state: RawInputState::new(),
            raw_op: ptr::null_mut(),
            line_op: ptr::null_mut(),
            held: Vec::new(),
            held_error: None,
            output: OutputState::new(),
            writes_in_flight: 0,
            pending: 0,
            pins: 0,
        }));
        // SAFETY: `inner` is at its final address; `link` is its first field.
        unsafe {
            Link::insert(inner.cast());
            Ok(Tty {
                inner: NonNull::new_unchecked(inner),
            })
        }
    }

    #[inline]
    fn raw(&self) -> *mut Inner {
        self.inner.as_ptr()
    }

    pub fn handle(&self) -> HANDLE {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe { (*self.raw()).handle }
    }

    /// The HANDLE as a system-kind `Fd`; `Fd::INVALID` once closed.
    pub fn fd(&self) -> Fd {
        let handle = self.handle();
        if handle == INVALID_HANDLE_VALUE {
            return Fd::INVALID;
        }
        Fd::from_system(handle)
    }

    /// An input handle (as opposed to a screen buffer).
    pub fn is_readable(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe { (*self.raw()).flags.contains(Flags::READABLE) }
    }

    pub fn is_closed(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe { (*self.raw()).flags.contains(Flags::DETACHED) }
    }

    pub fn is_reading(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        let inner = unsafe { &*self.raw() };
        !inner.flags.contains(Flags::DETACHED) && inner.flags.contains(Flags::READING)
    }

    /// Leave the caller's `Fd` open when the tty closes. A duplicate made for
    /// a standard handle is still released.
    pub fn disown(&mut self) {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            if !(*self.raw()).duplicated {
                (*self.raw()).close_fd = None;
            }
        }
    }

    pub fn is_active(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        let inner = unsafe { &*self.raw() };
        !inner.flags.contains(Flags::DETACHED)
            && (inner.flags.contains(Flags::READING) || inner.writes_in_flight > 0)
    }

    /// Let reading keep the loop alive (the default).
    pub fn ref_(&self) {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            (*self.raw()).flags.insert(Flags::REFD);
            Inner::update_keep_alive(self.raw());
        }
    }

    pub fn unref(&self) {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            (*self.raw()).flags.remove(Flags::REFD);
            Inner::update_keep_alive(self.raw());
        }
    }

    /// Set the console's input mode through this (input) handle.
    pub fn set_mode(&mut self, mode: Mode) -> sys::Result<()> {
        if !self.is_readable() {
            return Err(sys::Error::from_code(E::EINVAL, Tag::uv_tty_set_mode).with_fd(self.fd()));
        }
        set_console_mode(self.handle(), mode)
    }

    /// Deliver console input to `on_read(ctx, ..)`, always from the loop. `ctx`
    /// must stay valid until `read_stop`, an `Err` event, or the `Tty` is
    /// closed or dropped. A console has no end of file.
    pub fn read_start<T>(
        &mut self,
        ctx: *mut T,
        on_read: unsafe fn(*mut T, ReadEvent<'_>),
    ) -> sys::Result<()> {
        unsafe fn call<T>(f: *const (), ctx: *mut c_void, event: ReadEvent<'_>) {
            // SAFETY: `f` was erased from exactly this type below.
            let f =
                unsafe { core::mem::transmute::<*const (), unsafe fn(*mut T, ReadEvent<'_>)>(f) };
            // SAFETY: the owner keeps `ctx` valid while reading.
            unsafe { f(ctx.cast::<T>(), event) }
        }
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            if (*this).flags.contains(Flags::DETACHED) || !(*this).flags.contains(Flags::READABLE) {
                return Err(sys::Error::from_code(E::EBADF, Tag::read));
            }
            (*this).reader = Some(Reader {
                ctx: ctx.cast(),
                f: on_read as *const (),
                call: call::<T>,
            });
            if (*this).flags.contains(Flags::READING) {
                return Ok(());
            }
            (*this).flags.insert(Flags::READING);
            Inner::update_keep_alive(this);
            Inner::arm(this).map_err(|err| {
                (*this).flags.remove(Flags::READING);
                Inner::update_keep_alive(this);
                sys::Error::from_win32(err, Tag::read)
            })
        }
    }

    /// Stop delivering, and stop taking input: whoever reads the console next
    /// (a child that inherits it) gets the next line. What the user had typed
    /// of the current one comes back with the next `read_start`.
    pub fn read_stop(&mut self) {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            let this = self.raw();
            (*this).flags.remove(Flags::READING);
            let line = (*this).line_op;
            if !line.is_null() && (*line).in_flight {
                LineOp::wake(line, &(*line).stop);
            }
            Inner::update_keep_alive(this);
        }
    }

    /// Write `data` to the screen buffer now, then call `on_write(ctx, ..)`
    /// from the loop. Nothing needs to outlive this call but `ctx`.
    pub fn write<T>(
        &mut self,
        data: &[u8],
        ctx: *mut T,
        on_write: unsafe fn(*mut T, sys::Result<usize>),
    ) -> sys::Result<()> {
        let this = self.raw();
        let result = self.try_write(data);
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            if (*this).flags.contains(Flags::DETACHED) {
                return result.map(|_| ());
            }
            let op = bun_core::heap::into_raw(Box::new(PostedOp {
                op: Op::new(PostedOp::complete),
                tty: this,
                write: Some((Callback::new(ctx, on_write), result)),
            }));
            if !super::post_to_loop((*this).link.loop_, &raw mut (*op).op) {
                drop(bun_core::heap::take(op));
                return Err(sys::Error::from_win32(win::last_error(), Tag::write));
            }
            (*this).pending += 1;
            (*this).writes_in_flight += 1;
            Inner::update_keep_alive(this);
        }
        Ok(())
    }

    /// Write `data` to the screen buffer now.
    pub fn try_write(&mut self, data: &[u8]) -> sys::Result<usize> {
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Tty` is; the console lock
        // inside `write` serializes every writer in the process.
        unsafe {
            if (*this).flags.intersects(Flags::DETACHED | Flags::READABLE) {
                return Err(sys::Error::from_code(E::EBADF, Tag::write));
            }
            match tty_output::write((*this).handle, &mut (*this).output, data) {
                Ok(()) => Ok(data.len()),
                Err(code) => Err(sys::Error::from_win32(
                    Win32Error::from_u32(code),
                    Tag::write,
                )),
            }
        }
    }

    /// Close. Writes whose callback has not run yet still call back (dropping
    /// the `Tty` instead calls nobody back).
    pub fn close(self) {
        let this = self.raw();
        core::mem::forget(self);
        // SAFETY: `this` is live until `Inner::close` decides otherwise.
        unsafe { Inner::close(this, false) };
    }
}

impl Drop for Tty {
    fn drop(&mut self) {
        // SAFETY: `inner` is live until `Inner::close` decides otherwise.
        unsafe { Inner::close(self.raw(), true) };
    }
}

impl Inner {
    #[inline]
    fn gone(&self) -> bool {
        self.flags.intersects(Flags::CLOSING | Flags::DETACHED)
    }

    /// # Safety
    /// `this` is live. Must run on the loop's thread.
    unsafe fn update_keep_alive(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            let inner = &mut *this;
            if inner.flags.contains(Flags::DETACHED) {
                return;
            }
            let wanted = !inner.flags.contains(Flags::CLOSING)
                && (inner.flags.contains(Flags::REFD | Flags::READING)
                    || inner.writes_in_flight > 0);
            if wanted == inner.flags.contains(Flags::KEEPING_ALIVE) {
                return;
            }
            inner.flags.set(Flags::KEEPING_ALIVE, wanted);
            if wanted {
                (*inner.link.loop_).add_active(1);
            } else {
                (*inner.link.loop_).sub_active(1);
            }
        }
    }

    /// Start whichever read the console's mode calls for, unless one is out.
    ///
    /// # Safety
    /// `this` is live, reading and not closing.
    unsafe fn arm(this: *mut Inner) -> Result<(), Win32Error> {
        // SAFETY: caller contract; the ops are owned by `this` and freed only
        // when no packet or thread refers to them.
        unsafe {
            let loop_ = (*this).link.loop_;
            let line_out = !(*this).line_op.is_null() && (*(*this).line_op).in_flight;
            let raw_out = !(*this).raw_op.is_null() && (*(*this).raw_op).armed;
            if line_out || raw_out {
                return Ok(());
            }

            let line = (*this).line_op;
            if current_mode() != Mode::Normal && !line.is_null() && (*line).carry > 0 {
                // Typed in line mode and never entered: a raw reader gets
                // those keys as they are.
                let carried = &(&(*line).chars)[..(*line).carry];
                (*this)
                    .held
                    .extend_from_slice(&bun_core::strings::to_utf8_alloc_with_type(carried));
                (*line).carry = 0;
            }

            if !(*this).held.is_empty() || (*this).held_error.is_some() {
                // From the loop, not from inside `read_start`.
                let op = bun_core::heap::into_raw(Box::new(PostedOp {
                    op: Op::new(PostedOp::complete),
                    tty: this,
                    write: None,
                }));
                if !super::post_to_loop(loop_, &raw mut (*op).op) {
                    drop(bun_core::heap::take(op));
                    return Err(win::last_error());
                }
                (*this).pending += 1;
                return Ok(());
            }

            if current_mode() == Mode::Normal {
                if (*this).line_op.is_null() {
                    (*this).line_op = bun_core::heap::into_raw(Box::new(LineOp {
                        op: Op::new(LineOp::complete),
                        tty: this,
                        handle: (*this).handle,
                        port: None,
                        in_flight: false,
                        cancel: AtomicBool::new(false),
                        stop: AtomicBool::new(false),
                        wake_lock: bun_threading::Mutex::new(),
                        in_call: AtomicBool::new(false),
                        chars: Vec::new(),
                        carry: 0,
                        bytes: Vec::new(),
                        error: 0,
                        woken: false,
                    }));
                }
                let op = (*this).line_op;
                let Some(port) = super::port_for(loop_) else {
                    return Err(win::last_error());
                };
                (*op).port = Some(port);
                (*op).error = 0;
                (*op).woken = false;
                (*op).bytes.clear();
                (*op).cancel.store(false, Ordering::Release);
                (*op).stop.store(false, Ordering::Release);
                LINE_READERS.fetch_add(1, Ordering::AcqRel);
                if !super::queue_blocking_work(LineOp::read_thread, op.cast()) {
                    let err = win::last_error();
                    LINE_READERS.fetch_sub(1, Ordering::AcqRel);
                    (*op).port = None;
                    return Err(err);
                }
                super::op_submitted(loop_);
                (*op).in_flight = true;
            } else {
                if (*this).raw_op.is_null() {
                    let wait = iocp::us_iocp_wait_create(loop_);
                    if wait.is_null() {
                        return Err(Win32Error::NOT_ENOUGH_MEMORY);
                    }
                    (*this).raw_op = bun_core::heap::into_raw(Box::new(RawOp {
                        op: Op::new(RawOp::complete),
                        tty: this,
                        wait,
                        armed: false,
                        buf: Vec::new(),
                    }));
                }
                let op = (*this).raw_op;
                if iocp::us_iocp_wait_start((*op).wait, (*this).handle, &raw mut (*op).op) != 0 {
                    return Err(win::last_error());
                }
                super::wait_submitted(loop_);
                RAW_WAITERS.fetch_add(1, Ordering::AcqRel);
                (*op).armed = true;
            }
            (*this).pending += 1;
            Ok(())
        }
    }

    /// # Safety
    /// `this` is live, pinned, reading and has a reader.
    unsafe fn deliver(this: *mut Inner, event: ReadEvent<'_>) {
        // SAFETY: caller contract.
        unsafe {
            if let Some(reader) = (*this).reader {
                (reader.call)(reader.f, reader.ctx, event);
            }
        }
    }

    /// After a read finished: report an arming failure like a read error.
    ///
    /// # Safety
    /// `this` is live and not closing.
    unsafe fn rearm(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).flags.contains(Flags::READING) {
                return;
            }
            if let Err(err) = Self::arm(this) {
                (*this).flags.remove(Flags::READING);
                Self::update_keep_alive(this);
                (*this).pins += 1;
                Self::deliver(this, ReadEvent::Err(sys::Error::from_win32(err, Tag::read)));
                (*this).pins -= 1;
            }
        }
    }

    /// # Safety
    /// `this` is live; the owner's `Tty` is consumed or being dropped.
    unsafe fn close(this: *mut Inner, silent: bool) {
        // SAFETY: caller contract.
        unsafe {
            (*this).flags.insert(Flags::OWNER_GONE);
            if silent {
                (*this).flags.insert(Flags::SILENT);
            }
            (*this).reader = None;
            if !(*this).gone() {
                Self::cancel_reads(this);
                (*this).flags.insert(Flags::CLOSING);
                (*this).flags.remove(Flags::READING);
                Self::update_keep_alive(this);
            }
            Self::maybe_finish(this);
        }
    }

    /// [`Link::shut`]: the loop is about to be freed.
    unsafe fn shut(link: *mut Link) {
        let this = link.cast::<Inner>();
        // SAFETY: `link` is the first field of a listed (live) `Inner`.
        unsafe {
            if !(*this).gone() {
                Self::cancel_reads(this);
            }
            (*this).flags.insert(Flags::CLOSING | Flags::SILENT);
            (*this).flags.remove(Flags::READING);
            (*this).reader = None;
            Self::update_keep_alive(this);
            (*this).flags.insert(Flags::DETACHED);
            Link::remove(link);
            Self::maybe_finish(this);
        }
    }

    /// # Safety
    /// `this` is live and neither closing nor detached.
    unsafe fn cancel_reads(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            let raw = (*this).raw_op;
            if !raw.is_null() && (*raw).armed && iocp::us_iocp_wait_stop((*raw).wait) != 0 {
                // Removed before it fired: no packet will come for it.
                (*raw).armed = false;
                RAW_WAITERS.fetch_sub(1, Ordering::AcqRel);
                super::op_dequeued((*this).link.loop_);
                (*this).pending -= 1;
            }
            let line = (*this).line_op;
            if !line.is_null() && (*line).in_flight {
                // The handle stays open until the read has returned.
                LineOp::wake(line, &(*line).cancel);
            }
        }
    }

    /// # Safety
    /// `this` is live.
    unsafe fn maybe_finish(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).flags.contains(Flags::CLOSING) || (*this).pending > 0 || (*this).pins > 0 {
                return;
            }
            if let Some(fd) = (*this).close_fd.take() {
                fd.close();
            }
            (*this).handle = INVALID_HANDLE_VALUE;
            if !(*this).flags.contains(Flags::OWNER_GONE) {
                return;
            }
            if !(*this).flags.contains(Flags::DETACHED) {
                Self::update_keep_alive(this);
                Link::remove(this.cast());
            }
            if !(*this).raw_op.is_null() {
                let raw = bun_core::heap::take((*this).raw_op);
                iocp::us_iocp_wait_free(raw.wait);
            }
            if !(*this).line_op.is_null() {
                drop(bun_core::heap::take((*this).line_op));
            }
            drop(bun_core::heap::take(this));
        }
    }
}

impl RawOp {
    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let raw = op.cast::<RawOp>();
        // SAFETY: `op` is the first field of the `RawOp` whose wait fired; the
        // tty outlives its packets (`pending`).
        unsafe {
            super::op_dequeued(loop_);
            RAW_WAITERS.fetch_sub(1, Ordering::AcqRel);
            (*raw).armed = false;
            let this = (*raw).tty;
            (*this).pending -= 1;
            if (*this).gone() {
                Inner::maybe_finish(this);
                return;
            }
            // Not reading: the records stay queued (the handle stays
            // signalled), and `read_start` arms again.
            if !(*this).flags.contains(Flags::READING) {
                return;
            }
            if current_mode() == Mode::Normal {
                Inner::rearm(this);
                return;
            }

            (*raw).buf.clear();
            let result =
                tty_input::read_raw((*this).handle, &mut (*this).raw_state, &mut (*raw).buf);
            (*this).pins += 1;
            if matches!(&result, Ok(read) if read.resized) {
                let listener = ON_RESIZE.load(Ordering::Acquire);
                if !listener.is_null() {
                    core::mem::transmute::<*mut (), fn()>(listener)();
                }
            }
            if !(*raw).buf.is_empty() && (*this).flags.contains(Flags::READING) {
                Inner::deliver(this, ReadEvent::Data(&mut (*raw).buf));
            }
            if let Err(code) = result
                && (*this).flags.contains(Flags::READING)
            {
                (*this).flags.remove(Flags::READING);
                Inner::deliver(
                    this,
                    ReadEvent::Err(sys::Error::from_win32(
                        Win32Error::from_u32(code),
                        Tag::read,
                    )),
                );
            }
            (*this).pins -= 1;
            if (*this).gone() {
                Inner::maybe_finish(this);
                return;
            }
            Inner::update_keep_alive(this);
            Inner::rearm(this);
        }
    }
}

impl LineOp {
    /// The console cannot abandon a line read; it can be made to return.
    ///
    /// # Safety
    /// `line` is live with its read in flight; `why` is its `cancel` or `stop`.
    unsafe fn wake(line: *mut LineOp, why: &AtomicBool) {
        // SAFETY: caller contract.
        unsafe {
            (*line).wake_lock.lock();
            why.store(true, Ordering::Release);
            if (*line).in_call.load(Ordering::Acquire) {
                let record = wake_record();
                let mut written: u32 = 0;
                win::WriteConsoleInputW((*line).handle, &raw const record, 1, &raw mut written);
            }
            (*line).wake_lock.unlock();
        }
    }

    unsafe extern "system" fn read_thread(context: *mut c_void) -> u32 {
        let op = context.cast::<LineOp>();
        // SAFETY: `context` is the `LineOp` submitted by `arm`, which stays
        // allocated until the packet posted below is dequeued; the loop thread
        // touches only `cancel` (atomic) in the meantime.
        unsafe {
            let chars = &mut (*op).chars;
            let mut kept = (*op).carry.min(LINE_READ_CHARS - 1);
            chars.truncate(kept);
            chars.reserve(LINE_READ_CHARS);
            loop {
                (*op).wake_lock.lock();
                let wanted =
                    !(*op).cancel.load(Ordering::Acquire) && !(*op).stop.load(Ordering::Acquire);
                (*op).in_call.store(wanted, Ordering::Release);
                (*op).wake_lock.unlock();
                if !wanted {
                    (*op).woken = true;
                    break;
                }
                let mut control = win::CONSOLE_READCONSOLE_CONTROL {
                    nLength: size_of::<win::CONSOLE_READCONSOLE_CONTROL>() as u32,
                    nInitialChars: kept as u32,
                    dwCtrlWakeupMask: 1 << WAKE_CHAR,
                    dwControlKeyState: 0,
                };
                let mut read: u32 = 0;
                if win::ReadConsoleW(
                    (*op).handle,
                    chars.as_mut_ptr().cast(),
                    LINE_READ_CHARS as u32,
                    &raw mut read,
                    &raw mut control,
                ) == 0
                {
                    (*op).in_call.store(false, Ordering::Release);
                    (*op).error = win::last_error().int().into();
                    break;
                }
                (*op).in_call.store(false, Ordering::Release);
                // The count covers the characters carried in through
                // `nInitialChars` as well.
                let total = (read as usize).min(LINE_READ_CHARS);
                chars.set_len(total);
                if total > 0 && chars[total - 1] == WAKE_CHAR {
                    kept = total - 1;
                    if (*op).cancel.load(Ordering::Acquire)
                        || (*op).stop.load(Ordering::Acquire)
                        || current_mode() != Mode::Normal
                    {
                        (*op).woken = true;
                        break;
                    }
                    // The user typed the wake key (or another reader's wake-up
                    // landed here): carry on editing the same line.
                    if kept + 1 >= LINE_READ_CHARS {
                        chars.set_len(kept);
                        break;
                    }
                    continue;
                }
                break;
            }
            if (*op).woken {
                chars.truncate(kept);
                (*op).carry = kept;
            } else {
                (*op).carry = 0;
                if (*op).error == 0 {
                    (*op).bytes = bun_core::strings::to_utf8_alloc_with_type(chars);
                }
            }
            LINE_READERS.fetch_sub(1, Ordering::AcqRel);
            if let Some(port) = (*op).port.take() {
                port.post(&raw mut (*op).op);
            }
        }
        0
    }

    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let line = op.cast::<LineOp>();
        // SAFETY: `op` is the first field of the `LineOp` whose helper thread
        // posted this packet and is done with it; the tty outlives its
        // packets (`pending`).
        unsafe {
            super::op_dequeued(loop_);
            (*line).in_flight = false;
            let this = (*line).tty;
            (*this).pending -= 1;
            if (*this).gone() {
                Inner::maybe_finish(this);
                return;
            }
            if (*line).error != 0 {
                (*this).held_error = Some(Win32Error::from_u32((*line).error));
            } else if !(*line).woken {
                (*this).held.append(&mut (*line).bytes);
            }
            Inner::flush_held(this);
        }
    }
}

impl Inner {
    /// Hand over what line reads produced, if the owner is reading, and keep
    /// reading.
    ///
    /// # Safety
    /// `this` is live and not closing.
    unsafe fn flush_held(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).flags.contains(Flags::READING) {
                return;
            }
            (*this).pins += 1;
            if !(*this).held.is_empty() {
                let mut data = core::mem::take(&mut (*this).held);
                Self::deliver(this, ReadEvent::Data(&mut data));
            }
            if let Some(err) = (*this).held_error.take()
                && (*this).flags.contains(Flags::READING)
            {
                (*this).flags.remove(Flags::READING);
                Self::deliver(this, ReadEvent::Err(sys::Error::from_win32(err, Tag::read)));
            }
            (*this).pins -= 1;
            if (*this).gone() {
                Self::maybe_finish(this);
                return;
            }
            Self::update_keep_alive(this);
            Self::rearm(this);
        }
    }
}

impl PostedOp {
    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        // SAFETY: `op` is the first field of a `PostedOp` posted by this
        // module; the tty outlives its packets (`pending`).
        unsafe {
            super::op_dequeued(loop_);
            let posted = bun_core::heap::take(op.cast::<PostedOp>());
            let this = posted.tty;
            (*this).pending -= 1;

            if let Some((callback, result)) = posted.write {
                (*this).writes_in_flight -= 1;
                if !(*this).flags.contains(Flags::SILENT) {
                    (*this).pins += 1;
                    callback.invoke(result);
                    (*this).pins -= 1;
                }
                if (*this).gone() {
                    Inner::maybe_finish(this);
                } else {
                    Inner::update_keep_alive(this);
                }
                return;
            }

            // Held input on its way to a reader that resumed.
            if (*this).gone() {
                Inner::maybe_finish(this);
            } else {
                Inner::flush_held(this);
            }
        }
    }
}
