//! POSIX signals.

use core::ffi::{c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr;

unsafe extern "C" {
    /// Sends `signal` to this thread.
    pub safe fn raise(signal: c_int) -> c_int;
    /// `SIGALRM` arrives in that many seconds. 0 cancels it.
    pub safe fn alarm(seconds: c_uint) -> c_uint;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    pub safe fn sigwait(set: &libc::sigset_t, signal: &mut c_int) -> c_int;
    safe fn sigemptyset(set: &mut libc::sigset_t) -> c_int;
    safe fn sigaddset(set: &mut libc::sigset_t, signal: c_int) -> c_int;
    safe fn sigprocmask(
        how: c_int,
        set: &libc::sigset_t,
        previous: Option<&mut libc::sigset_t>,
    ) -> c_int;
    safe fn pthread_sigmask(
        how: c_int,
        set: &libc::sigset_t,
        previous: Option<&mut libc::sigset_t>,
    ) -> c_int;
}

/// BunSignalActions.cpp tells Bun from a library by the return address, which a tail call from a handler would lose.
fn rule_out_tail_call<T>(result: T) {
    core::hint::black_box(result);
}

pub fn empty_set() -> libc::sigset_t {
    let mut set = crate::ffi::zeroed();
    sigemptyset(&mut set);
    set
}

pub fn set_of(signal: c_int) -> libc::sigset_t {
    let mut set = empty_set();
    sigaddset(&mut set, signal);
    set
}

/// For this thread.
pub fn unblock(signal: c_int) {
    pthread_sigmask(libc::SIG_UNBLOCK, &set_of(signal), None);
}

/// Until the result is dropped.
pub fn block(signal: c_int) -> Blocked {
    let mut previous = empty_set();
    sigprocmask(libc::SIG_BLOCK, &set_of(signal), Some(&mut previous));
    Blocked(previous, PhantomData)
}

/// The mask that this thread had, so it is not `Send`.
#[must_use]
pub struct Blocked(libc::sigset_t, PhantomData<*const ()>);

impl Drop for Blocked {
    fn drop(&mut self) {
        rule_out_tail_call(sigprocmask(libc::SIG_SETMASK, &self.0, None));
    }
}

pub type Handler = extern "C" fn(c_int);
/// The third argument is the `ucontext_t` of the code that was interrupted.
pub type HandlerWithInfo = unsafe extern "C" fn(c_int, &libc::siginfo_t, *mut c_void);

/// A `struct sigaction` whose handler has the signature that its flags say.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Action(libc::sigaction);

impl Action {
    fn new(handler: libc::sighandler_t, flags: c_int) -> Action {
        let mut action: libc::sigaction = crate::ffi::zeroed();
        action.sa_sigaction = handler;
        action.sa_flags = flags;
        action.sa_mask = empty_set();
        Action(action)
    }

    pub fn call(handler: Handler, flags: c_int) -> Action {
        Action::new(handler as libc::sighandler_t, flags & !libc::SA_SIGINFO)
    }

    pub fn call_with_info(handler: HandlerWithInfo, flags: c_int) -> Action {
        Action::new(handler as libc::sighandler_t, flags | libc::SA_SIGINFO)
    }

    /// `signal` waits while the handler runs.
    pub fn blocking(mut self, signal: c_int) -> Action {
        sigaddset(&mut self.0.sa_mask, signal);
        self
    }

    /// The action that `signal` has. `None` if libc refuses the number.
    pub fn of(signal: c_int) -> Option<Action> {
        // SAFETY: it installs nothing.
        unsafe { exchange(signal, None) }
    }

    /// An address, `SIG_DFL` or `SIG_IGN`.
    pub fn handler(&self) -> libc::sighandler_t {
        self.0.sa_sigaction
    }

    pub fn flags(&self) -> c_int {
        self.0.sa_flags
    }

    /// SAFETY: it is sound for the handler to interrupt any code on any thread when `signal` arrives.
    pub unsafe fn install(&self, signal: c_int) {
        // SAFETY: it reads one `sigaction`. The caller answers for the handler.
        rule_out_tail_call(unsafe { libc::sigaction(signal, &raw const self.0, ptr::null_mut()) });
    }

    /// Returns the action that `signal` had.
    ///
    /// SAFETY: as [`Self::install`].
    pub unsafe fn replace(&self, signal: c_int) -> Option<Action> {
        // SAFETY: the caller's contract.
        unsafe { exchange(signal, Some(self)) }
    }
}

/// SAFETY: as [`Action::install`].
unsafe fn exchange(signal: c_int, action: Option<&Action>) -> Option<Action> {
    let mut previous: libc::sigaction = crate::ffi::zeroed();
    let action = action.map_or(ptr::null(), |action| &raw const action.0);
    // SAFETY: each pointer is null or valid for the call. The caller answers for the handler.
    let rc = unsafe { libc::sigaction(signal, action, &raw mut previous) };
    (rc == 0).then_some(Action(previous))
}

/// `sigaction` with `SIG_DFL`.
pub fn reset(signal: c_int, flags: c_int) {
    // SAFETY: it has no handler.
    unsafe { Action::new(libc::SIG_DFL, flags).install(signal) };
}

/// `signal` with `SIG_DFL`.
pub fn signal_default(signal: c_int) {
    // SAFETY: it has no handler.
    rule_out_tail_call(unsafe { libc::signal(signal, libc::SIG_DFL) });
}

/// From then on a write to a closed pipe or past the limit of the file size returns `EPIPE` or `EFBIG`.
pub fn ignore_for_failed_writes() {
    for signal in [libc::SIGPIPE, libc::SIGXFSZ] {
        // BunSignalActions.cpp looks `signal` up at its first call, which must not be that of a handler.
        // SAFETY: no handler, and not the signal of an instruction that must not be stepped over.
        unsafe { libc::signal(signal, libc::SIG_IGN) };
    }
}

/// Whether handlers with `SA_ONSTACK` run on the stack of the code that they interrupt on this thread.
pub fn lacks_alternate_stack() -> bool {
    let mut current = libc::stack_t {
        ss_sp: ptr::null_mut(),
        ss_flags: 0,
        ss_size: 0,
    };
    // SAFETY: it writes one `stack_t`.
    let rc = unsafe { libc::sigaltstack(ptr::null(), &raw mut current) };
    rc == 0 && current.ss_flags & libc::SS_DISABLE != 0
}

/// SAFETY: `stack` is writable, and nothing else uses it until this thread has ended or no longer has it.
pub unsafe fn set_alternate_stack(stack: *mut [u8]) -> bool {
    let stack = libc::stack_t {
        ss_sp: stack.cast(),
        ss_flags: 0,
        ss_size: stack.len(),
    };
    // SAFETY: the caller's contract.
    unsafe { libc::sigaltstack(&raw const stack, ptr::null_mut()) == 0 }
}

/// `false` if the system refuses, as while this thread runs there.
pub(crate) fn remove_alternate_stack() -> bool {
    let none = libc::stack_t {
        ss_sp: ptr::null_mut(),
        ss_flags: libc::SS_DISABLE,
        // macOS returns `ENOMEM` for less than `MINSIGSTKSZ`.
        ss_size: libc::SIGSTKSZ,
    };
    // SAFETY: it reads one `stack_t`, which names no memory.
    unsafe { libc::sigaltstack(&raw const none, ptr::null_mut()) == 0 }
}
