//! Signal masks, and the `sigaction` calls that install no handler.

use core::ffi::c_int;
use core::marker::PhantomData;
use core::ptr;

/// The `sigset_t` that holds only `sig`.
pub fn sigmask(sig: c_int) -> libc::sigset_t {
    let mut set: libc::sigset_t = crate::ffi::zeroed();
    // SAFETY: both only write `set`; `sigaddset` rejects an invalid signal number.
    unsafe {
        libc::sigemptyset(&raw mut set);
        libc::sigaddset(&raw mut set, sig);
    }
    set
}

/// `sigaction(sig, SIG_DFL)`.
pub fn set_default_action(sig: c_int) {
    let mut act: libc::sigaction = crate::ffi::zeroed();
    act.sa_sigaction = libc::SIG_DFL;
    // SAFETY: `act` is only read, and `SIG_DFL` installs no handler.
    unsafe { libc::sigaction(sig, &raw const act, ptr::null_mut()) };
}

/// The current `sa_sigaction` of `sig`: a handler's address, `SIG_DFL` or `SIG_IGN`.
pub fn current_action(sig: c_int) -> Option<libc::sighandler_t> {
    let mut current: libc::sigaction = crate::ffi::zeroed();
    // SAFETY: a null new action only reads the current one into valid memory.
    let rc = unsafe { libc::sigaction(sig, ptr::null(), &raw mut current) };
    (rc == 0).then_some(current.sa_sigaction)
}

/// `pthread_sigmask(SIG_UNBLOCK)`.
pub fn unblock(sig: c_int) {
    let set = sigmask(sig);
    // SAFETY: `set` is only read.
    unsafe { libc::pthread_sigmask(libc::SIG_UNBLOCK, &raw const set, ptr::null_mut()) };
}

/// Restores the signal mask of the thread that called [`block`] on `Drop`.
#[must_use = "dropping the guard restores the signal mask"]
pub struct SignalMaskGuard {
    old_mask: libc::sigset_t,
    _not_send: PhantomData<*const ()>,
}

/// `pthread_sigmask(SIG_BLOCK)`.
pub fn block(sig: c_int) -> SignalMaskGuard {
    let set = sigmask(sig);
    let mut old_mask: libc::sigset_t = crate::ffi::zeroed();
    // SAFETY: `set` is only read, and `old_mask` is a valid out-param.
    unsafe { libc::pthread_sigmask(libc::SIG_BLOCK, &raw const set, &raw mut old_mask) };
    SignalMaskGuard {
        old_mask,
        _not_send: PhantomData,
    }
}

impl Drop for SignalMaskGuard {
    fn drop(&mut self) {
        // SAFETY: `old_mask` is only read.
        unsafe {
            libc::pthread_sigmask(libc::SIG_SETMASK, &raw const self.old_mask, ptr::null_mut())
        };
    }
}
