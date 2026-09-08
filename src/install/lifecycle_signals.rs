//! Forwards SIGINT/SIGTERM/SIGHUP sent to `bun install` to its running
//! lifecycle scripts instead of dying at once and orphaning them. After
//! forwarding, the hook is removed (a second signal takes the default action),
//! no new script starts, and once the last script exits `bun install` dies by
//! the same signal. The hook itself is `bun_spawn::exit_signals`.

use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering};

use bun_spawn::exit_signals;

use crate::PackageManager;
use crate::lifecycle_script_runner::LifecycleScriptSubprocess;

static RUNNING: AtomicUsize = AtomicUsize::new(0);
/// A signal was forwarded; the install is draining.
static DRAINING: AtomicBool = AtomicBool::new(false);
static MANAGER: AtomicPtr<PackageManager> = AtomicPtr::new(core::ptr::null_mut());

/// The forwarded signal, if draining. While `Some`, no script starts or chains.
pub(crate) fn pending() -> Option<bun_core::SignalCode> {
    if !DRAINING.load(Ordering::Relaxed) {
        return None;
    }
    exit_signals::received().map(signal_code)
}

fn signal_code(sig: c_int) -> bun_core::SignalCode {
    u8::try_from(sig)
        .ok()
        .and_then(bun_core::SignalCode::from_raw)
        .unwrap_or(bun_core::SignalCode::DEFAULT)
}

/// Call before spawning a lifecycle script. `manager` must be the
/// allocation-rooted `PackageManager` pointer; it is dereferenced from the
/// signal callback until the last script exits.
pub(crate) fn on_script_started(manager: *mut PackageManager) {
    if RUNNING.fetch_add(1, Ordering::Relaxed) != 0 {
        return;
    }
    MANAGER.store(manager, Ordering::Relaxed);
    // SAFETY: `manager` is live; only `event_loop` is borrowed, for this call.
    let event_loop =
        bun_event_loop::EventLoopHandle::from_any(unsafe { &mut (*manager).event_loop });
    exit_signals::hook(event_loop, on_signal);
}

/// Call when a lifecycle script exited or failed to spawn. After the last
/// one, dies by the forwarded signal if draining, else unhooks.
pub(crate) fn on_script_exited() {
    if RUNNING.fetch_sub(1, Ordering::Relaxed) != 1 {
        return;
    }
    if let Some(sig) = pending() {
        die(sig);
    }
    exit_signals::unhook();
    MANAGER.store(core::ptr::null_mut(), Ordering::Relaxed);
}

fn die(sig: bun_core::SignalCode) -> ! {
    bun_core::Output::flush();
    bun_core::Global::raise_ignoring_panic_handler(sig);
}

/// Install thread, between event loop ticks.
fn on_signal(sig: c_int) {
    let manager = MANAGER.load(Ordering::Relaxed);
    if manager.is_null() || RUNNING.load(Ordering::Relaxed) == 0 {
        // The last script exited before this ran: nothing to wait for.
        die(signal_code(sig));
    }
    DRAINING.store(true, Ordering::Relaxed);
    exit_signals::unhook();
    let forward = signal_code(sig) as u8;
    // SAFETY: `manager` is live (see `on_script_started`); the heap is only
    // touched on this thread.
    unsafe {
        (*manager).active_lifecycle_scripts.for_each(
            |script: *mut LifecycleScriptSubprocess<'static>| {
                if let Some(process) = &(*script).process
                    && !process.process_mut().has_exited()
                {
                    let _ = process.kill(forward);
                }
            },
        );
    }
}
