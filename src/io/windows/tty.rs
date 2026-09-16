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
//!
//! The console cannot abandon a line read, but it returns from one when a
//! chosen control character is entered (`dwCtrlWakeupMask`). Ending a read
//! therefore means typing that key into the console's input queue, which every
//! reader of the console shares. [`LINE_LOCK`] keeps the key addressed: one
//! `ReadConsoleW` of this process at a time, the key typed only while that call
//! is out and once per call, and the console's mode changed only between calls
//! so the call is always a cooked one.

use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicU32, AtomicU64, Ordering};
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
static RAW_WAITERS: AtomicU32 = AtomicU32::new(0);
static ON_RESIZE: AtomicPtr<()> = AtomicPtr::new(ptr::null_mut());

/// Held to change anything below, to change the console's mode, and to type
/// the wake key.
static LINE_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
/// A helper thread waits here for [`LINE_READER`] to become free, or to be
/// told that its read is not wanted any more.
static LINE_TURN: bun_threading::Condition = bun_threading::Condition::new();
/// The read whose helper thread is inside `ReadConsoleW`.
static LINE_READER: AtomicPtr<LineOp> = AtomicPtr::new(ptr::null_mut());
/// The wake key has been typed for [`LINE_READER`]'s call.
static WAKE_TYPED: AtomicBool = AtomicBool::new(false);
/// Console mode flags (wanted in the high half, fallback in the low half) that
/// [`LINE_READER`]'s helper sets when its call returns; `u64::MAX` for none.
static PENDING_FLAGS: AtomicU64 = AtomicU64::new(u64::MAX);

/// Ends a blocked line read without touching the screen: the console returns
/// from `ReadConsoleW` when this control character is entered
/// (`dwCtrlWakeupMask`) and stores it where the cursor was. What was typed left
/// of the cursor is in front of it; what follows it is not the text right of
/// the cursor on every console host.
const WAKE_CHAR: u16 = 0x1d;
/// No keyboard produces this virtual key, so the record below is never a key
/// the user pressed (Ctrl+] is the same character). The line editor only looks
/// at the character.
const WAKE_VIRTUAL_KEY: u16 = 0xFF;

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

/// `SetConsoleMode` flags for `mode`: the ones wanted, and the ones to settle
/// for on a console that refuses those.
fn mode_flags(mode: Mode) -> (u32, u32) {
    match mode {
        Mode::Normal => {
            let flags =
                win::ENABLE_ECHO_INPUT | win::ENABLE_LINE_INPUT | win::ENABLE_PROCESSED_INPUT;
            (flags, flags)
        }
        Mode::Raw => (win::ENABLE_WINDOW_INPUT, win::ENABLE_WINDOW_INPUT),
        // A console without VT input: the key table does the translation.
        Mode::RawVt => (
            win::ENABLE_WINDOW_INPUT | win::ENABLE_VIRTUAL_TERMINAL_INPUT,
            win::ENABLE_WINDOW_INPUT,
        ),
    }
}

/// # Safety
/// `input` is a console input handle.
unsafe fn apply_flags(input: HANDLE, wanted: u32, fallback: u32) -> Result<(), Win32Error> {
    // SAFETY: plain Win32 calls on the caller's console handle.
    unsafe {
        if win::SetConsoleMode(input, wanted) != 0
            || (fallback != wanted && win::SetConsoleMode(input, fallback) != 0)
        {
            return Ok(());
        }
    }
    Err(win::last_error())
}

/// Set the input mode of the console `input` belongs to. Readers on any thread
/// switch between the line and raw mechanisms on their own.
pub fn set_console_mode(input: HANDLE, mode: Mode) -> sys::Result<()> {
    let fail = |err: Win32Error| sys::Error::from_win32(err, Tag::uv_tty_set_mode);
    let (wanted, fallback) = mode_flags(mode);
    let _lock = LINE_LOCK.lock_guard();
    let mut previous: u32 = 0;
    // SAFETY: `previous` is a live local.
    if unsafe { win::GetConsoleMode(input, &raw mut previous) } == 0 {
        return Err(fail(win::last_error()));
    }
    // A screen buffer has a mode too, with other bits.
    let mut events: u32 = 0;
    // SAFETY: `events` is a live local.
    if unsafe { win::GetNumberOfConsoleInputEvents(input, &raw mut events) } == 0 {
        return Err(sys::Error::from_code(E::EINVAL, Tag::uv_tty_set_mode));
    }
    if ORIGINAL_INPUT_MODE
        .compare_exchange(u32::MAX, previous, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        bun_core::add_exit_callback(Bun__Windows__resetConsoleMode);
    }
    if mode == Mode::Normal || LINE_READER.load(Ordering::Acquire).is_null() {
        // SAFETY: `GetConsoleMode` accepted `input`.
        unsafe { apply_flags(input, wanted, fallback) }.map_err(fail)?;
        PENDING_FLAGS.store(u64::MAX, Ordering::Release);
    } else {
        // A `ReadConsoleW` that finds the console out of line mode hands back
        // whatever is queued, the wake key anywhere among it. The helper makes
        // the change when its call, woken here, has returned.
        PENDING_FLAGS.store(
            u64::from(wanted) << 32 | u64::from(fallback),
            Ordering::Release,
        );
        type_wake_key();
    }
    let was = current_mode();
    INPUT_MODE.store(mode as u8, Ordering::Release);
    if was != Mode::Normal && mode == Mode::Normal {
        wake_raw_waiters(input);
    } else if was == Mode::Normal && mode != Mode::Normal {
        // Helpers still waiting for their turn have nothing to wait for.
        LINE_TURN.broadcast();
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
    // By name: a handle the mode was changed through may have been closed
    // since, and its value reused for something else.
    // SAFETY: plain Win32 call; the name is NUL-terminated.
    let console = unsafe {
        win::CreateFileW(
            bun_core::w!("CONIN$\0").as_ptr(),
            win::GENERIC_READ | win::GENERIC_WRITE,
            bun_sys::windows::FILE_SHARE_READ | bun_sys::windows::FILE_SHARE_WRITE,
            ptr::null_mut(),
            win::OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if console == INVALID_HANDLE_VALUE {
        return;
    }
    {
        let _lock = LINE_LOCK.lock_guard();
        // A line read that is out wants the console in line mode, which is
        // what this is about to be: nothing to wait for.
        PENDING_FLAGS.store(u64::MAX, Ordering::Release);
        // SAFETY: `console` is the console's input.
        let _ = unsafe { apply_flags(console, original, original) };
        let was = current_mode();
        INPUT_MODE.store(Mode::Normal as u8, Ordering::Release);
        if was != Mode::Normal {
            wake_raw_waiters(console);
        }
    }
    // SAFETY: opened above.
    unsafe { win::CloseHandle(console) };
}

/// [`set_console_mode`] for `wtf-bindings.cpp`. `mode` is 0 normal, 1 raw,
/// 2 "IO" (not supported) or 3 raw with VT input, the numbers of libuv's
/// `uv_tty_mode_t`; the result is 0 or a negative `UV_E*` number.
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

/// The console is in line mode again: get the raw readers to re-arm.
fn wake_raw_waiters(input: HANDLE) {
    if RAW_WAITERS.load(Ordering::Acquire) == 0 {
        return;
    }
    // Any record signals the handle; this one means nothing to anybody.
    // SAFETY: an all-zero `INPUT_RECORD` is a valid (empty) record.
    let mut record: win::INPUT_RECORD = unsafe { bun_core::ffi::zeroed_unchecked() };
    record.EventType = win::FOCUS_EVENT;
    let mut written: u32 = 0;
    // SAFETY: `record` is initialized; `written` is a live local.
    unsafe { win::WriteConsoleInputW(input, &raw const record, 1, &raw mut written) };
}

/// End [`LINE_READER`]'s `ReadConsoleW`. With [`LINE_LOCK`] held.
fn type_wake_key() {
    let reader = LINE_READER.load(Ordering::Acquire);
    if reader.is_null() || WAKE_TYPED.load(Ordering::Acquire) {
        return;
    }
    let record = wake_record();
    let mut written: u32 = 0;
    // SAFETY: `reader` stays allocated while it is `LINE_READER`, which only
    // changes under the lock the caller holds; `written` is a live local.
    let typed = unsafe {
        win::WriteConsoleInputW((*reader).handle, &raw const record, 1, &raw mut written)
    } != 0
        && written == 1;
    WAKE_TYPED.store(typed, Ordering::Release);
}

pub(super) fn wake_record() -> win::INPUT_RECORD {
    // SAFETY: an all-zero `INPUT_RECORD` is a valid (empty) record.
    let mut record: win::INPUT_RECORD = unsafe { bun_core::ffi::zeroed_unchecked() };
    record.EventType = win::KEY_EVENT;
    record.Event.KeyEvent = bun_windows_sys::KEY_EVENT_RECORD {
        bKeyDown: 1,
        wRepeatCount: 1,
        wVirtualKeyCode: WAKE_VIRTUAL_KEY,
        wVirtualScanCode: 0,
        uChar: bun_windows_sys::KEY_EVENT_RECORD_uChar {
            UnicodeChar: WAKE_CHAR,
        },
        dwControlKeyState: win::LEFT_CTRL_PRESSED,
    };
    record
}

/// Whether `key` is [`wake_record`] as the console hands it to a raw reader.
pub(super) fn is_wake_key(key: &bun_windows_sys::KEY_EVENT_RECORD) -> bool {
    // SAFETY: both members of the union are plain integers.
    key.wVirtualKeyCode == WAKE_VIRTUAL_KEY && unsafe { key.uChar.UnicodeChar } == WAKE_CHAR
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
    /// See [`Tty::end_input_at_ctrl_z`].
    ctrl_z_ends_input: bool,
    /// A line that started with Ctrl-Z arrived; nothing was read after it.
    held_end: bool,

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
    /// Raised with [`LINE_LOCK`] held.
    cancel: AtomicBool,
    stop: AtomicBool,
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
            ctrl_z_ends_input: false,
            held_end: false,
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

    /// A line that starts with Ctrl-Z ends the input (`ReadEvent::Eof`), and
    /// the rest of that line is dropped: what a `ReadFile` of a console in line
    /// mode does, and so what `type con`, `more` and the C runtime's `read` do.
    /// For an owner that reads the console as a stream of bytes. Reading again
    /// starts with the next line.
    pub fn end_input_at_ctrl_z(&mut self) {
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe { (*self.raw()).ctrl_z_ends_input = true };
    }

    /// Deliver console input to `on_read(ctx, ..)`, always from the loop. `ctx`
    /// must stay valid until `read_stop`, an `Err` or `Eof` event, or the `Tty`
    /// is closed or dropped. A console has no end of file but the one
    /// [`end_input_at_ctrl_z`](Self::end_input_at_ctrl_z) asks for.
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
    /// from the loop. Nothing needs to outlive this call but `ctx`. On `Err`
    /// nothing was written and `on_write` is not called.
    pub fn write<T>(
        &mut self,
        data: &[u8],
        ctx: *mut T,
        on_write: unsafe fn(*mut T, sys::Result<usize>),
    ) -> sys::Result<()> {
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Tty` is.
        unsafe {
            if (*this).flags.intersects(Flags::DETACHED | Flags::READABLE) {
                return Err(sys::Error::from_code(E::EBADF, Tag::write));
            }
            let result = self.try_write(data);
            let op = bun_core::heap::into_raw(Box::new(PostedOp {
                op: Op::new(PostedOp::complete),
                tty: this,
                write: Some((Callback::new(ctx, on_write), result)),
            }));
            super::complete_from_loop((*this).link.loop_, &raw mut (*op).op);
            (*this).pending += 1;
            (*this).writes_in_flight += 1;
            Inner::update_keep_alive(this);
        }
        Ok(())
    }

    /// Write UTF-8 `data` to the screen buffer now.
    pub fn try_write(&mut self, data: &[u8]) -> sys::Result<usize> {
        self.write_now(data.len(), |handle, output| {
            tty_output::write(handle, output, data)
        })
    }

    /// Write UTF-16 `data` to the screen buffer now. The count is the length
    /// of the text as UTF-8, as [`try_write`](Self::try_write) would report it.
    pub fn try_write_utf16(&mut self, data: &[u16]) -> sys::Result<usize> {
        self.write_now(
            bun_core::strings::element_length_utf16_into_utf8(data),
            |handle, output| tty_output::write_utf16(handle, output, data),
        )
    }

    /// As [`try_write_utf16`](Self::try_write_utf16) for Latin-1 `data`.
    pub fn try_write_latin1(&mut self, data: &[u8]) -> sys::Result<usize> {
        self.write_now(
            bun_core::strings::element_length_latin1_into_utf8(data),
            |handle, output| tty_output::write_latin1(handle, output, data),
        )
    }

    fn write_now(
        &mut self,
        utf8_len: usize,
        write: impl FnOnce(HANDLE, &mut OutputState) -> Result<(), u32>,
    ) -> sys::Result<usize> {
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Tty` is; the console lock
        // inside `tty_output` serializes every writer in the process.
        unsafe {
            if (*this).flags.intersects(Flags::DETACHED | Flags::READABLE) {
                return Err(sys::Error::from_code(E::EBADF, Tag::write));
            }
            match write((*this).handle, &mut (*this).output) {
                Ok(()) => Ok(utf8_len),
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
                super::complete_from_loop(loop_, &raw mut (*op).op);
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
                if !super::queue_blocking_work(LineOp::read_thread, op.cast()) {
                    let err = win::last_error();
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

    /// Every call out to the owner goes through here: the owner may close or
    /// drop its `Tty` from inside one. Returns whether `this` is still open;
    /// when it is not, it may be freed already.
    ///
    /// # Safety
    /// `this` is live.
    #[must_use]
    unsafe fn with_owner(this: *mut Inner, call: impl FnOnce()) -> bool {
        // SAFETY: caller contract; `pins` keeps `this` allocated across `call`.
        unsafe {
            (*this).pins += 1;
            call();
            (*this).pins -= 1;
            if (*this).gone() {
                Self::maybe_finish(this);
                return false;
            }
        }
        true
    }

    /// # Safety
    /// `this` is live, inside [`with_owner`](Self::with_owner), and reading.
    unsafe fn deliver(this: *mut Inner, event: ReadEvent<'_>) {
        // SAFETY: caller contract.
        unsafe {
            if let Some(reader) = (*this).reader {
                (reader.call)(reader.f, reader.ctx, event);
            }
        }
    }

    /// After a read finished: report an arming failure like a read error.
    /// `this` may be freed when this returns.
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
                let _ = Self::with_owner(this, || {
                    Self::deliver(this, ReadEvent::Err(sys::Error::from_win32(err, Tag::read)));
                });
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
            if matches!(&result, Ok(read) if read.wake_key) {
                // If a line read is waiting for that key, this read got to
                // the queue ahead of it.
                let _lock = LINE_LOCK.lock_guard();
                if WAKE_TYPED.swap(false, Ordering::AcqRel) {
                    type_wake_key();
                }
            }
            if matches!(&result, Ok(read) if read.resized) {
                let listener = ON_RESIZE.load(Ordering::Acquire);
                if !listener.is_null() {
                    // SAFETY: non-null `ON_RESIZE` is a `fn()` stored by
                    // `set_resize_listener`.
                    core::mem::transmute::<*mut (), fn()>(listener)();
                }
            }
            let open = Inner::with_owner(this, || {
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
            });
            if !open {
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
        let _lock = LINE_LOCK.lock_guard();
        why.store(true, Ordering::Release);
        if LINE_READER.load(Ordering::Acquire) == line {
            type_wake_key();
        } else {
            // Not in the call: its helper looks at `why` before it enters.
            LINE_TURN.broadcast();
        }
    }

    /// Wait until no other `ReadConsoleW` of this process is out, then claim
    /// the console for `op`'s. `false` if the read stopped being wanted first.
    ///
    /// # Safety
    /// `op` is live; called from its helper thread.
    unsafe fn enter_call(op: *mut LineOp) -> bool {
        let _lock = LINE_LOCK.lock_guard();
        loop {
            // SAFETY: caller contract.
            let unwanted = unsafe {
                (*op).cancel.load(Ordering::Acquire) || (*op).stop.load(Ordering::Acquire)
            };
            if unwanted || current_mode() != Mode::Normal {
                return false;
            }
            if LINE_READER.load(Ordering::Acquire).is_null() {
                LINE_READER.store(op, Ordering::Release);
                WAKE_TYPED.store(false, Ordering::Release);
                return true;
            }
            LINE_TURN.wait(&LINE_LOCK);
        }
    }

    /// The call returned. `true` if somebody wants this read over.
    ///
    /// # Safety
    /// `op` is live and is [`LINE_READER`]; called from its helper thread.
    unsafe fn leave_call(op: *mut LineOp) -> bool {
        let _lock = LINE_LOCK.lock_guard();
        LINE_READER.store(ptr::null_mut(), Ordering::Release);
        let pending = PENDING_FLAGS.swap(u64::MAX, Ordering::AcqRel);
        if pending != u64::MAX {
            // SAFETY: caller contract; `handle` is this console's input. The
            // mode was accepted as far as `set_console_mode` could tell.
            let _ = unsafe { apply_flags((*op).handle, (pending >> 32) as u32, pending as u32) };
        }
        LINE_TURN.broadcast();
        // SAFETY: caller contract.
        unsafe {
            (*op).cancel.load(Ordering::Acquire)
                || (*op).stop.load(Ordering::Acquire)
                || current_mode() != Mode::Normal
        }
    }

    unsafe extern "system" fn read_thread(context: *mut c_void) -> u32 {
        let op = context.cast::<LineOp>();
        // SAFETY: `context` is the `LineOp` submitted by `arm`, which stays
        // allocated until the packet posted below is dequeued; the loop thread
        // touches only `cancel` and `stop` (atomic) in the meantime.
        unsafe {
            let chars = &mut (*op).chars;
            let mut kept = (*op).carry.min(LINE_READ_CHARS - 1);
            chars.truncate(kept);
            chars.reserve(LINE_READ_CHARS);
            loop {
                if !Self::enter_call(op) {
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
                let error = if win::ReadConsoleW(
                    (*op).handle,
                    chars.as_mut_ptr().cast(),
                    LINE_READ_CHARS as u32,
                    &raw mut read,
                    &raw mut control,
                ) == 0
                {
                    u32::from(win::last_error().int())
                } else {
                    0
                };
                let unwanted = Self::leave_call(op);
                if error != 0 {
                    (*op).error = error;
                    break;
                }
                // The count covers the characters carried in through
                // `nInitialChars` as well.
                let total = (read as usize).min(LINE_READ_CHARS);
                chars.set_len(total);
                let Some(wake_at) = bun_core::strings::index_of_any16(chars, &[WAKE_CHAR]) else {
                    break;
                };
                // Entered with the cursor inside the line, the key is not
                // last: only what is in front of it is the line so far.
                kept = wake_at;
                if unwanted {
                    (*op).woken = true;
                    break;
                }
                // The user entered it: carry on editing the same line.
                if kept + 1 >= LINE_READ_CHARS {
                    chars.set_len(kept);
                    break;
                }
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
                if (*this).ctrl_z_ends_input && (*line).bytes.first() == Some(&0x1A) {
                    (*line).bytes.clear();
                    (*this).held_end = true;
                } else {
                    (*this).held.append(&mut (*line).bytes);
                }
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
            let open = Self::with_owner(this, || {
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
                if (*this).held_end && (*this).flags.contains(Flags::READING) {
                    (*this).held_end = false;
                    (*this).flags.remove(Flags::READING);
                    Self::deliver(this, ReadEvent::Eof);
                }
            });
            if !open {
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
                let open = Inner::with_owner(this, || {
                    if !(*this).flags.contains(Flags::SILENT) {
                        callback.invoke(result);
                    }
                });
                if open {
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
