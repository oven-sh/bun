//! Ctrl+C for a process acting as a shell for foreground children (`bun run`,
//! `bun exec`, `bun x.sh`) — bash's wait-and-cooperative-exit. The terminal
//! delivers Ctrl+C to us and the children together (same pgroup / same
//! console), so while a foreground child is alive it is the child's to handle
//! and we only note that it happened; with none alive it kills us as usual.
//! Whether that Ctrl+C then ends *us* is decided by the caller from how the
//! job exited (`child_died_of_it` / `exit_like_child`). Like bash, nothing is
//! forwarded: a SIGINT sent to this pid alone does not reach the child.

use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use crate::process::Status;

/// Foreground children currently alive.
static CHILDREN: AtomicU32 = AtomicU32::new(0);
/// A Ctrl+C arrived while `CHILDREN > 0` and was left to them.
static RECEIVED: AtomicBool = AtomicBool::new(false);

/// Process-lifetime; the handler is inert while no `Child` is alive. Not
/// inherited by children: a caught signal resets to `SIG_DFL` on exec, and a
/// console handler routine is per-process.
pub fn install() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        #[cfg(unix)]
        // SAFETY: zeroed sigaction + a handler fn is a valid disposition.
        unsafe {
            let mut sa: libc::sigaction = bun_core::ffi::zeroed();
            sa.sa_sigaction = handler as *const () as usize;
            sa.sa_flags = libc::SA_RESTART;
            libc::sigemptyset(&raw mut sa.sa_mask);
            libc::sigaction(libc::SIGINT, &raw const sa, core::ptr::null_mut());
        }
        #[cfg(windows)]
        {
            let _ = bun_sys::windows::SetConsoleCtrlHandler(Some(handler), bun_sys::windows::TRUE);
        }
    });
}

#[cfg(unix)]
extern "C" fn handler(sig: core::ffi::c_int) {
    if CHILDREN.load(Ordering::SeqCst) > 0 {
        RECEIVED.store(true, Ordering::SeqCst);
        return;
    }
    // SAFETY: SIG_DFL is a valid disposition; SIGINT is blocked while we run,
    // so the re-raise is delivered (fatally) once we return.
    unsafe {
        let mut sa: libc::sigaction = bun_core::ffi::zeroed();
        sa.sa_sigaction = libc::SIG_DFL;
        libc::sigaction(sig, &raw const sa, core::ptr::null_mut());
        libc::raise(sig);
    }
}

#[cfg(windows)]
extern "system" fn handler(ctrl_type: bun_sys::windows::DWORD) -> bun_sys::windows::BOOL {
    if ctrl_type == bun_sys::windows::CTRL_C_EVENT && CHILDREN.load(Ordering::SeqCst) > 0 {
        RECEIVED.store(true, Ordering::SeqCst);
        return bun_sys::windows::TRUE;
    }
    bun_sys::windows::FALSE
}

/// A live foreground child. Enter before spawning so there is no window in
/// which a Ctrl+C kills us with the child already created.
pub struct Child(());
impl Child {
    pub fn enter() -> Self {
        CHILDREN.fetch_add(1, Ordering::SeqCst);
        Self(())
    }

    pub fn alive() -> u32 {
        CHILDREN.load(Ordering::SeqCst)
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        CHILDREN.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Whether a Ctrl+C was left to the children since the last call.
pub fn take_received() -> bool {
    RECEIVED.swap(false, Ordering::SeqCst)
}

/// `status` is that of a `Child` that just exited: did a Ctrl+C we left to it
/// kill it? (A child that raised SIGINT at itself with no Ctrl+C seen here is
/// just an exit status.)
pub fn child_died_of_it(status: &Status) -> bool {
    if !RECEIVED.load(Ordering::SeqCst) {
        return false;
    }
    #[cfg(unix)]
    return status.signal_code() == Some(bun_core::SignalCode::SIGINT);
    #[cfg(windows)]
    return matches!(status, Status::Exited(e) if e.raw == bun_sys::windows::STATUS_CONTROL_C_EXIT);
}

/// End this process the way a child killed by Ctrl+C ended.
pub fn exit_like_child() -> ! {
    #[cfg(unix)]
    bun_core::Global::raise_ignoring_panic_handler(bun_core::SignalCode::SIGINT);
    #[cfg(windows)]
    bun_core::Global::exit(bun_sys::windows::STATUS_CONTROL_C_EXIT);
}
