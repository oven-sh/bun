//! SIGINT, SIGTERM and SIGHUP sent to `bun install` while a lifecycle script
//! runs (CI cancellation, `docker stop`, `timeout(1)`, a hung-up ssh session).
//!
//! Without this the default action ends `bun install` at once and every
//! running script is reparented to init, still writing into `node_modules`.
//! Instead, while at least one script runs, the signal is forwarded to each
//! script and `bun install` waits. No new script starts. When the last
//! script has exited, `bun install` dies by the forwarded signal, the same way
//! it already does for a script that dies by a signal on its own. The hook
//! comes out as soon as the signal is forwarded, so a second signal takes the
//! default action (on Linux the scripts then die with `bun install`, see
//! `linux_pdeathsig` in the runner).
//!
//! The hook itself is `bun_spawn::exit_signals`. This module is the install
//! half: which scripts run, what to forward, when to exit.

use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering};

use bun_spawn::exit_signals;

use crate::PackageManager;
use crate::lifecycle_script_runner::LifecycleScriptSubprocess;

/// Number of lifecycle scripts that are running right now.
static RUNNING: AtomicUsize = AtomicUsize::new(0);
/// Set once the signal has been forwarded and the install is draining.
static DRAINING: AtomicBool = AtomicBool::new(false);
static MANAGER: AtomicPtr<PackageManager> = AtomicPtr::new(core::ptr::null_mut());

/// The signal that `bun install` forwarded to the running scripts, if any.
/// While this is `Some`, no new lifecycle script starts and an exiting script
/// does not chain into the next one.
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

/// A lifecycle script is about to be spawned. Hooks the signals on the first
/// one.
///
/// `manager` is the live `PackageManager` that owns the script. The signal
/// callback dereferences it until the last script has exited, so it must
/// carry allocation-rooted provenance, not a transient `&mut` reborrow.
pub(crate) fn on_script_started(manager: *mut PackageManager) {
    if RUNNING.fetch_add(1, Ordering::Relaxed) != 0 {
        return;
    }
    MANAGER.store(manager, Ordering::Relaxed);
    // SAFETY: `manager` is live (caller contract). Only the `event_loop`
    // field is borrowed, and the borrow ends with this statement.
    let event_loop =
        bun_event_loop::EventLoopHandle::from_any(unsafe { &mut (*manager).event_loop });
    exit_signals::hook(event_loop, on_signal);
}

/// A lifecycle script exited (after it left `active_lifecycle_scripts`), or
/// failed to spawn. After the last one: dies by the forwarded signal when
/// draining, else unhooks.
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

/// Runs on the install thread, between event loop ticks.
fn on_signal(sig: c_int) {
    let manager = MANAGER.load(Ordering::Relaxed);
    if manager.is_null() || RUNNING.load(Ordering::Relaxed) == 0 {
        // The last script exited between the handler and this callback.
        // Nothing to wait for: the default action, now.
        die(signal_code(sig));
    }
    DRAINING.store(true, Ordering::Relaxed);
    exit_signals::unhook();
    let forward = signal_code(sig) as u8;
    // SAFETY: `manager` is the live `PackageManager` stored by
    // `on_script_started`; nothing else walks or mutates the heap while this
    // runs on the install thread.
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
