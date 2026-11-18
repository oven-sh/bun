//! The thread waits in the handler of a signal.

use core::cell::UnsafeCell;
use core::ffi::{c_int, c_void};
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering::SeqCst};

use bun_threading::Futex;

use super::Registers;

/// Packages use `SIGUSR1` for their own purposes.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub const SIGNAL: c_int = libc::SIGPWR;
#[cfg(target_os = "freebsd")]
pub const SIGNAL: c_int = libc::SIGUSR1;

/// The low bits of `STATE`. The others count the requests, so that no state is taken for that of an earlier one.
const PHASES: u32 = 4;
const REQUESTED: u32 = 1;
const ACCEPTED: u32 = 2;
const SUSPENDED: u32 = 3;

static STATE: AtomicU32 = AtomicU32::new(0);
static TARGET: AtomicUsize = AtomicUsize::new(0);
static REGISTERS: Slot = Slot(UnsafeCell::new(MaybeUninit::uninit()));

struct Slot(UnsafeCell<MaybeUninit<Registers>>);

// SAFETY: written in the phase `ACCEPTED` by the thread that got there, read in the phase `SUSPENDED` by the holder of the lock.
unsafe impl Sync for Slot {}

fn advance(from: u32) {
    STATE.store(from.wrapping_add(1), SeqCst);
    Futex::wake(&STATE, u32::MAX);
}

fn current_thread() -> libc::pthread_t {
    // SAFETY: no preconditions.
    unsafe { libc::pthread_self() }
}

fn registers_in(context: &libc::ucontext_t) -> Registers {
    let machine = &context.uc_mcontext;
    #[cfg(all(not(target_os = "freebsd"), target_arch = "x86_64"))]
    return Registers {
        program_counter: machine.gregs[libc::REG_RIP as usize] as usize,
        stack_pointer: machine.gregs[libc::REG_RSP as usize] as usize,
        frame_pointer: machine.gregs[libc::REG_RBP as usize] as usize,
        bytecode_pointer: machine.gregs[libc::REG_R12 as usize] as usize,
    };
    #[cfg(all(not(target_os = "freebsd"), target_arch = "aarch64"))]
    return Registers {
        program_counter: machine.pc as usize,
        stack_pointer: machine.sp as usize,
        frame_pointer: machine.regs[29] as usize,
        bytecode_pointer: machine.regs[20] as usize,
        link_register: machine.regs[30] as usize,
    };
    #[cfg(all(target_os = "freebsd", target_arch = "x86_64"))]
    return Registers {
        program_counter: machine.mc_rip as usize,
        stack_pointer: machine.mc_rsp as usize,
        frame_pointer: machine.mc_rbp as usize,
        bytecode_pointer: machine.mc_r12 as usize,
    };
    #[cfg(all(target_os = "freebsd", target_arch = "aarch64"))]
    return Registers {
        program_counter: machine.mc_gpregs.gp_elr as usize,
        stack_pointer: machine.mc_gpregs.gp_sp as usize,
        frame_pointer: machine.mc_gpregs.gp_x[29] as usize,
        bytecode_pointer: machine.mc_gpregs.gp_x[20] as usize,
        link_register: machine.mc_gpregs.gp_lr as usize,
    };
}

/// Anybody can send the signal. It only counts while there is a request for this thread.
unsafe extern "C" fn handle_signal(_: c_int, _: *mut libc::siginfo_t, context: *mut c_void) {
    let requested = STATE.load(SeqCst);
    let (accepted, suspended) = (requested.wrapping_add(1), requested.wrapping_add(2));
    if requested % PHASES != REQUESTED
        || TARGET.load(SeqCst) != current_thread() as usize
        || (STATE.compare_exchange(requested, accepted, SeqCst, SeqCst)).is_err()
    {
        return;
    }
    let errno = bun_core::ffi::errno_ptr();
    // SAFETY: the kernel passes the context, `errno` is that of this thread, and the phase gives it the slot.
    let interrupted_errno = unsafe {
        (*REGISTERS.0.get()).write(registers_in(&*context.cast()));
        *errno
    };
    advance(accepted);
    while STATE.load(SeqCst) == suspended {
        Futex::wait_forever(&STATE, suspended);
    }
    // SAFETY: as above.
    unsafe { *errno = interrupted_errno };
}

pub(super) fn initialize() {
    let mut action = MaybeUninit::<libc::sigaction>::zeroed();
    // SAFETY: zero is a value of each field, and the handler only calls what is safe in one.
    let result = unsafe {
        let action = action.assume_init_mut();
        action.sa_sigaction = handle_signal as *const () as usize;
        action.sa_flags = libc::SA_RESTART | libc::SA_SIGINFO;
        libc::sigfillset(&raw mut action.sa_mask);
        libc::sigaction(SIGNAL, action, core::ptr::null_mut())
    };
    assert!(result == 0);
}

pub(super) struct Thread(usize);

impl Thread {
    pub(super) fn current() -> Thread {
        let mut signals = MaybeUninit::<libc::sigset_t>::uninit();
        // SAFETY: the set is initialized before it is read.
        unsafe {
            libc::sigemptyset(signals.as_mut_ptr());
            libc::sigaddset(signals.as_mut_ptr(), SIGNAL);
            libc::pthread_sigmask(libc::SIG_UNBLOCK, signals.as_ptr(), core::ptr::null_mut());
        }
        Thread(current_thread() as usize)
    }

    /// # Safety
    /// The thread has not ended, and no thread is suspended or will be until this one is resumed.
    pub(super) unsafe fn suspend(&self) -> Option<Registers> {
        let idle = STATE.load(SeqCst);
        TARGET.store(self.0, SeqCst);
        STATE.store(idle + REQUESTED, SeqCst);
        // SAFETY: the caller's.
        if unsafe { libc::pthread_kill(self.0 as libc::pthread_t, SIGNAL) } != 0
            && STATE
                .compare_exchange(idle + REQUESTED, idle.wrapping_add(PHASES), SeqCst, SeqCst)
                .is_ok()
        {
            return None;
        }
        loop {
            let state = STATE.load(SeqCst);
            if state == idle + SUSPENDED {
                // SAFETY: the handler has written it and waits.
                return Some(unsafe { (*REGISTERS.0.get()).assume_init() });
            }
            debug_assert!(state == idle + REQUESTED || state == idle + ACCEPTED);
            Futex::wait_forever(&STATE, state);
        }
    }

    /// # Safety
    /// The thread is suspended.
    pub(super) unsafe fn resume(&self) {
        advance(STATE.load(SeqCst));
    }
}
