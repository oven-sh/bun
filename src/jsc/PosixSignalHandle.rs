use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};
#[cfg(unix)]
use core::sync::atomic::{AtomicI32, fence};

use crate::JSGlobalObject;
#[cfg(unix)]
use crate::VirtualMachineRef as VirtualMachine;
#[cfg(unix)]
use crate::{Task, event_loop::EventLoop};
use bun_event_loop::{Taskable, task_tag};
#[cfg(unix)]
use bun_sys::FdExt as _;
#[cfg(unix)]
use bun_threading::SignalRing;

#[cfg(unix)]
const BUFFER_SIZE: usize = 8192;

/// Signal numbers queued by signal handlers on any thread for the main loop.
#[cfg(unix)]
#[derive(Default)]
pub struct PosixSignalHandle {
    ring: SignalRing<BUFFER_SIZE>,
}

#[cfg(unix)]
impl PosixSignalHandle {
    // `pub const new = bun.TrivialNew(@This());`
    pub(crate) fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    /// Returns `false` if the ring is full. The caller wakes the loop on `true`.
    pub(crate) fn enqueue(&self, signal: u8) -> bool {
        self.ring.enqueue(signal)
    }

    /// Drain as many signals as possible and enqueue them as tasks in the event loop.
    /// Called by the main thread, the ring's single consumer.
    pub(crate) fn drain(&self, event_loop: &mut EventLoop) {
        while let Some(signal) = self.ring.dequeue() {
            // `Task` is a plain `{ tag, ptr }` pair (no bitfield packing), so build it
            // directly — `bun_runtime::dispatch::run_task` unpacks `task.ptr as usize as u8`.
            let task = Task::init(signal as usize as *mut PosixSignalTask);
            event_loop.enqueue_task(task);
        }
    }

    /// The main thread's handle; `None` in a worker (no POSIX signals there, and the ring has one consumer).
    fn for_main_thread(global_object: &JSGlobalObject) -> Option<bun_ptr::BackRef<Self>> {
        if !global_object.bun_vm().is_main_thread() {
            return None;
        }
        let vm = VirtualMachine::get_main_thread_vm()?;
        // SAFETY: `vm` and its event loop are process-lifetime; only the `signal_handler` slot is read.
        unsafe { (*(*vm).event_loop()).signal_handler }
    }

    /// While the guard lives, the signal handler also writes a byte to a pipe per queued signal, so a host function that blocks the JS thread (`prompt()`) can poll [`BlockingWait::fd`] next to its input. `None` off the main thread or when no JS signal listener exists.
    pub fn blocking_wait(global_object: &JSGlobalObject) -> Option<BlockingWait> {
        Self::for_main_thread(global_object)?;
        let read = match BLOCKING_WAIT_PIPE[0].load(Ordering::Acquire) {
            -1 => create_blocking_wait_pipe()?,
            fd => bun_sys::Fd::from_native(fd),
        };
        BLOCKING_WAITERS.fetch_add(1, Ordering::SeqCst);
        // With the fence in `Bun__onPosixSignal`: the caller's next ring drain sees a signal, or that signal's handler sees this waiter.
        fence(Ordering::SeqCst);
        Some(BlockingWait { read })
    }

    /// Runs the JS listeners for every queued signal now. Main thread only (a no-op elsewhere).
    pub fn run_queued_from_js_thread(global_object: &JSGlobalObject) {
        let Some(handler) = Self::for_main_thread(global_object) else {
            return;
        };
        let mut ran = false;
        while let Some(signal) = handler.ring.dequeue() {
            PosixSignalTask::run_from_js_thread(signal, global_object);
            ran = true;
        }
        // Like Node after a signal callback: lets `async` and `nextTick` listeners finish. `Stopped` surfaces at the caller's read.
        if ran {
            let _ = global_object.drain_microtasks_and_next_ticks();
        }
    }
}

/// See [`PosixSignalHandle::blocking_wait`].
#[cfg(unix)]
pub struct BlockingWait {
    read: bun_sys::Fd,
}

#[cfg(unix)]
impl BlockingWait {
    /// Readable while a queued signal has not been taken with [`BlockingWait::drain`].
    pub fn fd(&self) -> bun_sys::Fd {
        self.read
    }

    /// Empties the pipe. Call it before the ring drain, so a signal that lands in between leaves a spare byte, never a signal without one.
    pub fn drain(&self) {
        let mut buf = [0u8; 64];
        while matches!(bun_sys::read(self.read, &mut buf), Ok(n) if n == buf.len()) {}
    }
}

#[cfg(unix)]
impl Drop for BlockingWait {
    fn drop(&mut self) {
        BLOCKING_WAITERS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// `[read, write]` ends of the pipe behind [`PosixSignalHandle::blocking_wait`]; -1 until created.
#[cfg(unix)]
static BLOCKING_WAIT_PIPE: [AtomicI32; 2] = [AtomicI32::new(-1), AtomicI32::new(-1)];

/// Live [`BlockingWait`] guards. The signal handler writes to the pipe only while this is not zero.
#[cfg(unix)]
static BLOCKING_WAITERS: AtomicU32 = AtomicU32::new(0);

/// Both ends are CLOEXEC, non-blocking and above fd 2: with fd 0 closed, a plain `pipe()` would hand out the number the dialog polls as stdin.
#[cfg(unix)]
fn create_blocking_wait_pipe() -> Option<bun_sys::Fd> {
    let ends = bun_sys::pipe().ok()?;
    let moved = ends.map(|fd| bun_sys::dup_at_least(fd, 3).ok());
    for fd in ends {
        let _ = fd.close_allowing_standard_io(None);
    }
    match moved {
        [Some(read), Some(write)]
            if bun_sys::set_nonblocking(read).is_ok()
                && bun_sys::set_nonblocking(write).is_ok() =>
        {
            BLOCKING_WAIT_PIPE[0].store(read.native(), Ordering::Release);
            BLOCKING_WAIT_PIPE[1].store(write.native(), Ordering::Release);
            Some(read)
        }
        _ => {
            for fd in moved.into_iter().flatten() {
                fd.close();
            }
            None
        }
    }
}

/// This is the signal handler entry point. Calls enqueue on the ring buffer.
/// Note: Must be minimal logic here. Only do atomics & signal-safe calls.
#[unsafe(no_mangle)]
extern "C" fn Bun__onPosixSignal(number: i32) {
    #[cfg(unix)]
    {
        // Watch-mode SIGINT with no JS listener: node's watcher (its own
        // process, idle loop) exits 0 immediately even when the script is
        // busy; `_exit` is async-signal-safe, the queued path would not run.
        if number == i32::from(SIGINT_NUMBER)
            && WATCH_MODE_KILL_SIGNAL.load(Ordering::Relaxed) != 0
            && WATCH_SIGINT_LISTENERS.load(Ordering::Acquire) == 0
        {
            // SAFETY: `_exit(2)` is async-signal-safe and takes no pointers.
            unsafe { libc::_exit(0) };
        }
        let Some(vm) = VirtualMachine::get_main_thread_vm() else {
            return;
        };
        // The writes below can fail; the interrupted code must still see its own errno.
        let _restore_errno = RestoreErrno(bun_core::ffi::errno());
        // SAFETY: `vm` and its event loop are process-lifetime; raw place
        // projection reads only the `signal_handler` slot (no `&EventLoop`
        // formed — the main thread may hold `&mut EventLoop` concurrently).
        let handler = unsafe { (*(*vm).event_loop()).signal_handler };
        if let Some(handler) = handler {
            // `BackRef::deref` is the centralised set-once-NonNull proof; the
            // pointee is all-atomic (`Sync`), so a `&PosixSignalHandle` from
            // async-signal context is sound.
            // No panic path in a signal handler: drop a number outside 1..=255.
            let Some(signal) = u8::try_from(number).ok().filter(|&s| s != 0) else {
                return;
            };
            if handler.enqueue(signal) {
                // See `PosixSignalHandle::blocking_wait`.
                fence(Ordering::SeqCst);
                if BLOCKING_WAITERS.load(Ordering::SeqCst) != 0 {
                    let wait_fd = BLOCKING_WAIT_PIPE[1].load(Ordering::Acquire);
                    // SAFETY: write(2) is async-signal-safe; O_NONBLOCK, and a full pipe is readable anyway.
                    let _ = unsafe { libc::write(wait_fd, (&raw const signal).cast(), 1) };
                }
                // SAFETY: same process-lifetime event loop as above; `wakeup`
                // is one async-signal-safe write to the loop's wakeup fd.
                unsafe { (*(*vm).event_loop()).wakeup() };
            }
        }
    }
    #[cfg(not(unix))]
    let _ = number;
}

#[cfg(unix)]
struct RestoreErrno(core::ffi::c_int);

#[cfg(unix)]
impl Drop for RestoreErrno {
    fn drop(&mut self) {
        // SAFETY: `errno_ptr()` is this thread's errno slot.
        unsafe { *bun_core::ffi::errno_ptr() = self.0 };
    }
}

pub struct PosixSignalTask;

impl Taskable for PosixSignalTask {
    const TAG: bun_event_loop::TaskTag = task_tag::PosixSignalTask;
    /// `this` packs the signal number; nothing is owned.
    unsafe fn release_unrun(_: *mut Self) {}
    /// A signal is the process's: `process.on(<signal>)` listeners of the realm.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

unsafe extern "C" {
    /// Returns whether any JS `process.on(<signal>)` listener actually ran.
    safe fn Bun__onSignalForJS(number: i32, global_object: &JSGlobalObject) -> bool;
    #[cfg(unix)]
    safe fn Bun__installWatchModeSignalHandler(number: i32);
}

/// Nonzero only for `bun run --watch` (RunCommand): the `--watch-kill-signal`
/// PLATFORM number (default SIGTERM) whose JS handlers are emitted before an
/// execve reload. Never set for `--hot`, the dev server, or `bun test --watch`.
static WATCH_MODE_KILL_SIGNAL: AtomicU8 = AtomicU8::new(0);

/// SIGINT is 2 on every supported platform (POSIX and the Windows CRT).
const SIGINT_NUMBER: u8 = 2;

#[cfg(unix)]
fn is_uncatchable_signal(number: i32) -> bool {
    number == libc::SIGKILL || number == libc::SIGSTOP
}
#[cfg(not(unix))]
fn is_uncatchable_signal(_number: i32) -> bool {
    false
}

/// True while the pre-reload kill-signal handlers run: `process.exit` inside
/// one must not stop the reload (node restarts the watched child regardless).
static IS_EMITTING_WATCH_KILL_SIGNAL: AtomicBool = AtomicBool::new(false);

/// JS listener count for the configured watch kill signal, mirrored here so
/// the watcher thread can decide between the immediate execve reload and the
/// event-loop reload that runs those handlers first (see `Task::enqueue`).
static WATCH_KILL_SIGNAL_LISTENERS: AtomicU32 = AtomicU32::new(0);

/// JS listener count for SIGINT, mirrored for the async-signal-safe fast exit
/// in `Bun__onPosixSignal` (a busy script must still die on Ctrl+C, like
/// node's watcher does from its own process).
static WATCH_SIGINT_LISTENERS: AtomicU32 = AtomicU32::new(0);

/// C++ `onDidChangeListeners` reports every `process.on(<signal>)` listener
/// count change here (main-thread VM only, platform signal numbers).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__onSignalListenerCountChanged(number: i32, count: i32) {
    let watch_signal = i32::from(WATCH_MODE_KILL_SIGNAL.load(Ordering::Relaxed));
    if watch_signal == 0 {
        return;
    }
    let count = count.max(0) as u32;
    // Uncatchable kill signals never emit, so their listeners must not divert
    // the reload off the immediate execve path.
    if number == watch_signal && !is_uncatchable_signal(number) {
        WATCH_KILL_SIGNAL_LISTENERS.store(count, Ordering::Release);
    }
    if number == i32::from(SIGINT_NUMBER) {
        WATCH_SIGINT_LISTENERS.store(count, Ordering::Release);
    }
}

/// Watcher-thread query: only ever true for `bun run --watch` (the count is
/// mirrored solely when `WATCH_MODE_KILL_SIGNAL` is set).
pub fn watch_kill_signal_has_listeners() -> bool {
    WATCH_KILL_SIGNAL_LISTENERS.load(Ordering::Acquire) > 0
}

/// `bun run --watch` startup: record the kill signal for pre-reload emission
/// and install a SIGINT handler so the watcher terminates like node's does
/// (exit 0; works even when SIGINT was inherited as SIG_IGN).
#[cfg(unix)]
pub fn enable_watch_mode_signals(kill_signal: bun_core::SignalCode) {
    WATCH_MODE_KILL_SIGNAL.store(kill_signal as u8, Ordering::Relaxed);
    Bun__installWatchModeSignalHandler(libc::SIGINT);
}

/// Windows has no sigaction to install; only record the signal so the
/// platform-agnostic pre-reload emit (`emit_watch_kill_signal_before_reload`)
/// still runs the JS handlers before a watch restart, like unix.
#[cfg(not(unix))]
pub fn enable_watch_mode_signals(kill_signal: bun_core::SignalCode) {
    WATCH_MODE_KILL_SIGNAL.store(kill_signal as u8, Ordering::Relaxed);
}

pub fn is_emitting_watch_kill_signal() -> bool {
    IS_EMITTING_WATCH_KILL_SIGNAL.load(Ordering::Relaxed)
}

/// Runs the JS handlers of the configured `--watch-kill-signal` synchronously,
/// mirroring node delivering that signal to the watched child before restart.
/// SIGKILL/SIGSTOP are uncatchable in node, so nothing is emitted for them.
pub(crate) fn emit_watch_kill_signal_before_reload(global_object: &JSGlobalObject) {
    let sig = WATCH_MODE_KILL_SIGNAL.load(Ordering::Relaxed);
    if sig == 0 || is_uncatchable_signal(i32::from(sig)) {
        return;
    }
    // Set once and left set: the caller proceeds straight into reload_process() without yielding,
    // and the grace-timer thread treats this flag as "JS thread is doing watch-reload work" for
    // its deadline extension. execve replaces the image, so nothing needs to clear it.
    IS_EMITTING_WATCH_KILL_SIGNAL.store(true, Ordering::Relaxed);
    let _ = Bun__onSignalForJS(i32::from(sig), global_object);
}

impl PosixSignalTask {
    pub fn run_from_js_thread(number: u8, global_object: &JSGlobalObject) {
        let fired = Bun__onSignalForJS(i32::from(number), global_object);
        // Node parity: in watch mode the watcher exits 0 on SIGINT when the
        // script has no handler for it (see `enable_watch_mode_signals`).
        if !fired && number == SIGINT_NUMBER && WATCH_MODE_KILL_SIGNAL.load(Ordering::Relaxed) != 0
        {
            bun_core::Output::flush();
            bun_core::Global::exit(0);
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__ensureSignalHandler() {
    #[cfg(unix)]
    {
        if let Some(vm) = VirtualMachine::get_main_thread_vm() {
            // SAFETY: `vm` and its event loop are process-lifetime.
            let this = unsafe { &mut *(*vm).event_loop() };
            if this.signal_handler.is_none() {
                let boxed = PosixSignalHandle::new(PosixSignalHandle::default());
                this.signal_handler =
                    Some(bun_ptr::BackRef::from(bun_core::heap::into_raw_nn(boxed)));
            }
        }
    }
}
