//! Ctrl+C for a process acting as a shell for foreground children (`bun run`,
//! `bun exec`, `bun x.sh`) — bash's wait-and-cooperative-exit. The terminal
//! delivers Ctrl+C to us and the children together (same pgroup / same
//! console), so while a foreground child is alive it is the child's to handle
//! and we only note that it happened; with none alive it kills us as usual.
//! Whether that Ctrl+C then ends *us* is decided by the caller from how the
//! job exited (`child_died_of_it` / `exit_like_child`). A SIGINT our parent
//! sends by kill(2) is forwarded to the children, as `sh -c <cmd>` gets by
//! exec'ing the command. A terminal Ctrl+C is not: it reached them already.

#[cfg(unix)]
use core::sync::atomic::AtomicI32;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use crate::process::Status;

/// Foreground children currently alive.
static CHILDREN: AtomicU32 = AtomicU32::new(0);
/// A Ctrl+C arrived while `CHILDREN > 0` and was left to them.
static RECEIVED: AtomicBool = AtomicBool::new(false);
/// Live foreground children the handler forwards to. Zero is a free slot.
#[cfg(unix)]
static PIDS: [AtomicI32; 64] = [const { AtomicI32::new(0) }; 64];

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
            sa.sa_flags = libc::SA_RESTART | libc::SA_SIGINFO;
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
extern "C" fn handler(
    sig: core::ffi::c_int,
    info: *const libc::siginfo_t,
    _context: *mut core::ffi::c_void,
) {
    if CHILDREN.load(Ordering::SeqCst) > 0 {
        RECEIVED.store(true, Ordering::SeqCst);
        // `si_pid` is 0 for a kernel-generated signal (the terminal's Ctrl+C).
        // SAFETY: `info` is the siginfo the kernel passes to an SA_SIGINFO handler.
        let sender = unsafe { (*info).si_pid() };
        if sender != 0 && sender == unsafe { libc::getppid() } {
            for slot in PIDS.iter() {
                let pid = slot.load(Ordering::SeqCst);
                if pid > 0 {
                    // SAFETY: `kill` on a pid we spawned and have not reaped.
                    unsafe { libc::kill(pid, sig) };
                }
            }
        }
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
pub struct Child {
    #[cfg(unix)]
    slot: Option<usize>,
}
impl Child {
    pub fn enter() -> Self {
        CHILDREN.fetch_add(1, Ordering::SeqCst);
        Self {
            #[cfg(unix)]
            slot: None,
        }
    }

    #[cfg(unix)]
    pub fn set_pid(&mut self, pid: i32) {
        if self.slot.is_some() {
            return;
        }
        self.slot = PIDS.iter().position(|slot| {
            slot.compare_exchange(0, pid, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        });
    }

    pub fn alive() -> u32 {
        CHILDREN.load(Ordering::SeqCst)
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(slot) = self.slot {
            PIDS[slot].store(0, Ordering::SeqCst);
        }
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
