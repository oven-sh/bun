use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU16, AtomicU32, Ordering};

use crate::event_loop::EventLoop;
use crate::{JSGlobalObject, Task, VirtualMachineRef as VirtualMachine};
use bun_event_loop::{Taskable, task_tag};

bun_core::declare_scope!(PosixSignalHandle, hidden);

const BUFFER_SIZE: u16 = 8192;

pub struct PosixSignalHandle {
    #[allow(dead_code)]
    signals: [AtomicU8; BUFFER_SIZE as usize],

    /// Producer index (signal handler writes).
    #[allow(dead_code)]
    tail: AtomicU16,
    /// Consumer index (main thread reads).
    head: AtomicU16,
}

impl Default for PosixSignalHandle {
    fn default() -> Self {
        Self {
            signals: [const { AtomicU8::new(0) }; BUFFER_SIZE as usize],
            tail: AtomicU16::new(0),
            head: AtomicU16::new(0),
        }
    }
}

impl PosixSignalHandle {
    // `pub const new = bun.TrivialNew(@This());`
    #[allow(dead_code)]
    pub(crate) fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    /// Called by the signal handler (single producer).
    /// Returns `true` if enqueued successfully, or `false` if the ring is full.
    #[allow(dead_code)]
    pub(crate) fn enqueue(&self, signal: u8) -> bool {
        // Read the current tail and head (Acquire to ensure we have up-to-date values).
        let old_tail = self.tail.load(Ordering::Acquire);
        let head_val = self.head.load(Ordering::Acquire);

        // Compute the next tail (wrapping around BUFFER_SIZE).
        let next_tail = old_tail.wrapping_add(1) % BUFFER_SIZE;

        // Check if the ring is full.
        if next_tail == (head_val % BUFFER_SIZE) {
            // The ring buffer is full.
            // We cannot block or wait here (since we're in a signal handler).
            // So we just drop the signal or log if desired.
            bun_core::scoped_log!(PosixSignalHandle, "signal queue is full; dropping");
            return false;
        }

        // Store the signal into the ring buffer slot (Release to ensure data is visible).
        self.signals[(old_tail % BUFFER_SIZE) as usize].store(signal, Ordering::Release);

        // Publish the new tail (Release so that the consumer sees the updated tail).
        self.tail.store(old_tail.wrapping_add(1), Ordering::Release);

        if let Some(vm) = VirtualMachine::get_main_thread_vm() {
            // SAFETY: `event_loop()` returns the VM-owned EventLoop; live for VM lifetime.
            unsafe { (*(*vm).event_loop()).wakeup() };
        }

        true
    }

    /// Called by the main thread (single consumer).
    /// Returns `None` if the ring is empty, or the next signal otherwise.
    #[allow(dead_code)]
    pub(crate) fn dequeue(&self) -> Option<u8> {
        // Read the current head and tail.
        let old_head = self.head.load(Ordering::Acquire);
        let tail_val = self.tail.load(Ordering::Acquire);

        // If head == tail, the ring is empty.
        if old_head == tail_val {
            return None; // No available items
        }

        let slot_index = (old_head % BUFFER_SIZE) as usize;
        // Acquire load of the stored signal to get the item.
        let signal = self.signals[slot_index].swap(0, Ordering::AcqRel);

        // Publish the updated head (Release).
        self.head.store(old_head.wrapping_add(1), Ordering::Release);

        Some(signal)
    }

    /// Drain as many signals as possible and enqueue them as tasks in the event loop.
    /// Called by the main thread.
    #[allow(dead_code)]
    pub(crate) fn drain(&self, event_loop: &mut EventLoop) {
        while let Some(signal) = self.dequeue() {
            // `Task` is a plain `{ tag, ptr }` pair (no bitfield packing), so build it
            // directly — `bun_runtime::dispatch::run_task` unpacks `task.ptr as usize as u8`.
            let task = Task::new(
                <PosixSignalTask as Taskable>::TAG,
                signal as usize as *mut (),
            );
            event_loop.enqueue_task(task);
        }
    }
}

/// This is the signal handler entry point. Calls enqueue on the ring buffer.
/// Note: Must be minimal logic here. Only do atomics & signal-safe calls.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__onPosixSignal(number: i32) {
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
            let _ = handler.enqueue(u8::try_from(number).expect("int cast"));
        }
    }
    #[cfg(not(unix))]
    let _ = number;
}

pub struct PosixSignalTask {
    pub number: u8,
}

impl Taskable for PosixSignalTask {
    const TAG: bun_event_loop::TaskTag = task_tag::PosixSignalTask;
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
    // Validated by Arguments.parse, so the platform number always exists.
    let number = kill_signal.platform_number().unwrap_or(libc::SIGTERM);
    WATCH_MODE_KILL_SIGNAL.store(number as u8, Ordering::Relaxed);
    Bun__installWatchModeSignalHandler(libc::SIGINT);
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
    IS_EMITTING_WATCH_KILL_SIGNAL.store(true, Ordering::Relaxed);
    let _ = Bun__onSignalForJS(i32::from(sig), global_object);
    IS_EMITTING_WATCH_KILL_SIGNAL.store(false, Ordering::Relaxed);
}

impl PosixSignalTask {
    // `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub fn run_from_js_thread(number: u8, global_object: &JSGlobalObject) {
        let fired = Bun__onSignalForJS(i32::from(number), global_object);
        // Node parity: in watch mode the watcher exits 0 on SIGINT when the
        // script has no handler for it (see `enable_watch_mode_signals`).
        if !fired
            && number == SIGINT_NUMBER
            && WATCH_MODE_KILL_SIGNAL.load(Ordering::Relaxed) != 0
        {
            bun_core::Output::flush();
            bun_core::Global::exit(0);
        }
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__ensureSignalHandler() {
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
