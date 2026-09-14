//! SIGTERM / SIGHUP sent to the pid of a bun-shell script runner (`bun run
//! --shell=bun`, `bun exec`, `bun x.sh`): recorded here, forwarded to the live
//! subprocesses by the interpreter between ticks, which then waits for them and
//! starts no further command. SIGINT is `bun_spawn::ctrl_c`'s (the terminal
//! signals the whole process group, so there is nothing to forward).

use core::sync::atomic::{AtomicPtr, AtomicU8, Ordering};

use bun_core::SignalCode;

/// A signal that arrived and is not forwarded yet. 0 while none.
static PENDING: AtomicU8 = AtomicU8::new(0);
/// The first signal that arrived. 0 while none. Decides the exit status.
static RECEIVED: AtomicU8 = AtomicU8::new(0);
/// Set by [`install`], cleared by [`uninstall`]. The uws loop is thread-lifetime.
static LOOP: AtomicPtr<bun_uws::Loop> = AtomicPtr::new(core::ptr::null_mut());

#[cfg(unix)]
const SIGNALS: [i32; 2] = [libc::SIGTERM, libc::SIGHUP];

/// Bit `i`: `SIGNALS[i]` is hooked. A signal inherited as `SIG_IGN` (`nohup`) is not.
#[cfg(unix)]
static HOOKED: AtomicU8 = AtomicU8::new(0);
/// Dispositions replaced by [`install`] and restored by [`uninstall`].
#[cfg(unix)]
static PREVIOUS: bun_core::RacyCell<core::mem::MaybeUninit<[libc::sigaction; 2]>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

#[cfg(unix)]
extern "C" fn handler(sig: core::ffi::c_int) {
    if bun_spawn::ctrl_c::Child::alive() == 0 {
        // Nothing to forward to (a builtin runs, or nothing): die from `sig`
        // now. A builtin may never yield to the loop (`yes > /dev/null`).
        // SAFETY: SIG_DFL is a valid disposition; `sig` is blocked while the
        // handler runs, so unblock it for the raise to be fatal here. `raise`
        // only returns for PID 1 of a pid namespace (signal discarded).
        unsafe {
            let mut action: libc::sigaction = bun_core::ffi::zeroed();
            action.sa_sigaction = libc::SIG_DFL;
            libc::sigaction(sig, &raw const action, core::ptr::null_mut());
            let mut set: libc::sigset_t = bun_core::ffi::zeroed();
            libc::sigemptyset(&raw mut set);
            libc::sigaddset(&raw mut set, sig);
            libc::pthread_sigmask(libc::SIG_UNBLOCK, &raw const set, core::ptr::null_mut());
            libc::raise(sig);
            libc::_exit(128 + sig);
        }
    }
    // The wakeup write may set errno; the interrupted code must not see that.
    let errno_ptr = bun_core::ffi::errno_ptr();
    // SAFETY: thread-local errno slot, valid for the calling thread.
    let saved = unsafe { *errno_ptr };
    let sig = sig as u8;
    let _ = RECEIVED.compare_exchange(0, sig, Ordering::AcqRel, Ordering::Acquire);
    PENDING.store(sig, Ordering::Release);
    let loop_ = LOOP.load(Ordering::Acquire);
    if !loop_.is_null() {
        // SAFETY: the loop is thread-lifetime and `us_wakeup_loop` is the
        // thread-safe entry point (an eventfd write, no lock).
        unsafe { bun_uws::us_wakeup_loop(loop_) };
    }
    // SAFETY: same slot.
    unsafe { *errno_ptr = saved };
}

/// `loop_` is the uws loop to wake. No `SA_RESETHAND`: a repeated signal is forwarded again.
pub(crate) fn install(loop_: *mut bun_uws::Loop) {
    PENDING.store(0, Ordering::Release);
    RECEIVED.store(0, Ordering::Release);
    LOOP.store(loop_, Ordering::Release);
    #[cfg(unix)]
    // SAFETY: zeroed sigaction + a handler fn is a valid disposition;
    // `sigemptyset` and `sigaction` are FFI calls over valid pointers.
    // `PREVIOUS` is written on this thread only, while no hook is active.
    unsafe {
        let mut action: libc::sigaction = bun_core::ffi::zeroed();
        action.sa_sigaction = handler as *const () as usize;
        libc::sigemptyset(&raw mut action.sa_mask);
        action.sa_flags = libc::SA_RESTART;
        let previous = (*PREVIOUS.get()).as_mut_ptr().cast::<libc::sigaction>();
        let mut hooked: u8 = 0;
        for (i, sig) in SIGNALS.into_iter().enumerate() {
            let slot = previous.add(i);
            libc::sigaction(sig, core::ptr::null(), slot);
            if (*slot).sa_sigaction != libc::SIG_IGN {
                libc::sigaction(sig, &raw const action, core::ptr::null_mut());
                hooked |= 1 << i;
            }
        }
        HOOKED.store(hooked, Ordering::Release);
    }
}

/// Puts back the disposition each hooked signal had before [`install`].
pub(crate) fn uninstall() {
    LOOP.store(core::ptr::null_mut(), Ordering::Release);
    #[cfg(unix)]
    {
        let hooked = HOOKED.swap(0, Ordering::AcqRel);
        // SAFETY: `install` filled `PREVIOUS[i]` for every bit set in `hooked`.
        unsafe {
            let previous = (*PREVIOUS.get()).as_ptr().cast::<libc::sigaction>();
            for (i, sig) in SIGNALS.into_iter().enumerate() {
                if hooked & (1 << i) != 0 {
                    libc::sigaction(sig, previous.add(i), core::ptr::null_mut());
                }
            }
        }
    }
}

/// The signal that arrived since the last call, if any.
pub(crate) fn take_pending() -> Option<SignalCode> {
    SignalCode::from_raw(PENDING.swap(0, Ordering::AcqRel))
}

/// The first signal that arrived during the run, if any.
pub(crate) fn received() -> Option<SignalCode> {
    SignalCode::from_raw(RECEIVED.load(Ordering::Acquire))
}

/// The signal the script was ended by: one arrived and was forwarded, and the
/// script's exit code is the one a shell reports for a command that signal
/// killed. A command that handled the signal and exited on its own terms
/// keeps its exit code.
pub(crate) fn ended_script(exit_code: crate::shell::interpreter::ExitCode) -> Option<SignalCode> {
    let sig = received()?;
    let signal_exit_code = bun_sys::SignalCode(sig as u8).to_exit_code()?;
    (exit_code == u16::from(signal_exit_code)).then_some(sig)
}
