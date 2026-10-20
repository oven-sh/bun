use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};

use crate::JSGlobalObject;
#[cfg(unix)]
use crate::VirtualMachineRef as VirtualMachine;
#[cfg(unix)]
use crate::{Task, event_loop::EventLoop};
use bun_event_loop::{Taskable, task_tag};
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
                // SAFETY: same process-lifetime event loop as above; `wakeup`
                // is one async-signal-safe write to the loop's wakeup fd.
                unsafe { (*(*vm).event_loop()).wakeup() };
            }
        }
    }
    #[cfg(not(unix))]
    let _ = number;
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
    let count = count.max(0) as u32;
    #[cfg(unix)]
    if let Some(slot) = stop_signal_slot(number) {
        STOP_SIGNAL_LISTENERS[slot].store(count, Ordering::SeqCst);
    }
    let watch_signal = i32::from(WATCH_MODE_KILL_SIGNAL.load(Ordering::Relaxed));
    if watch_signal == 0 {
        return;
    }
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

/// Records the signal whose JS handlers `emit_watch_kill_signal_before_reload` runs before a
/// restart, without the watch-mode SIGINT handler: for a process that reloads in place and only
/// sometimes starts again (`bun bake`).
pub fn set_watch_kill_signal(kill_signal: bun_core::SignalCode) {
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

/// A SIGINT or SIGTERM from outside the process was dispatched: the watcher starts nothing again and leaves once nothing is pending.
#[cfg(unix)]
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Per stop signal: its `process.on` listeners (main thread VM).
#[cfg(unix)]
static STOP_SIGNAL_LISTENERS: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];

/// Per stop signal: `process.kill(process.pid, ..)` calls whose delivery is not dispatched yet.
#[cfg(unix)]
static SELF_SENT_STOP_SIGNALS: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];

/// The signals that node's watcher takes as a request to stop.
#[cfg(unix)]
fn stop_signal_slot(number: i32) -> Option<usize> {
    match number {
        libc::SIGINT => Some(0),
        libc::SIGTERM => Some(1),
        _ => None,
    }
}

/// `process.kill(process.pid, number)` is about to send. With no listener the signal is not dispatched.
#[cfg(unix)]
#[unsafe(no_mangle)]
extern "C" fn Bun__onSelfSentSignal(number: i32) {
    if let Some(slot) = stop_signal_slot(number)
        && STOP_SIGNAL_LISTENERS[slot].load(Ordering::SeqCst) > 0
    {
        SELF_SENT_STOP_SIGNALS[slot].fetch_add(1, Ordering::SeqCst);
    }
}

/// Whether the watcher was asked to stop. Always false on Windows, where the keep-alive loop never runs dry.
pub fn stop_requested() -> bool {
    #[cfg(unix)]
    return STOP_REQUESTED.load(Ordering::SeqCst);
    #[cfg(not(unix))]
    false
}

impl PosixSignalTask {
    pub fn run_from_js_thread(number: u8, global_object: &JSGlobalObject) {
        // Before the listeners: one of them can send the signal again.
        #[cfg(unix)]
        if let Some(slot) = stop_signal_slot(i32::from(number)) {
            let self_sent = SELF_SENT_STOP_SIGNALS[slot]
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |pending| {
                    pending.checked_sub(1)
                })
                .is_ok();
            let vm = global_object.bun_vm().as_mut();
            if !self_sent && vm.is_watcher_enabled() {
                STOP_REQUESTED.store(true, Ordering::SeqCst);
                // No save starts the script again now, so an uncaught error ends the process, as without a watcher.
                vm.exit_on_uncaught_exception = true;
            }
        }
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
