use core::ffi::{c_int, c_void};
use core::mem::MaybeUninit;
use core::ptr;
use std::sync::OnceLock;

use super::{Registers, redirect};

const SIGNALS: [c_int; 2] = [libc::SIGSEGV, libc::SIGBUS];

static PREVIOUS: [OnceLock<libc::sigaction>; SIGNALS.len()] = [const { OnceLock::new() }; _];

fn action(handler: libc::sighandler_t, flags: c_int) -> libc::sigaction {
    // SAFETY: zeros are valid for all fields, and the set is valid for the write.
    unsafe {
        let mut action = MaybeUninit::<libc::sigaction>::zeroed().assume_init();
        libc::sigemptyset(&raw mut action.sa_mask);
        action.sa_sigaction = handler;
        action.sa_flags = flags as _;
        action
    }
}

pub(super) fn install_handler() -> bool {
    // On the other stack, if the thread has one, because the previous handler may report that the stack is exhausted.
    let flags = libc::SA_SIGINFO | libc::SA_ONSTACK | libc::SA_RESTART;
    let ours = action(handle as *const () as usize, flags);
    SIGNALS
        .into_iter()
        .zip(&PREVIOUS)
        .all(|(signal, previous)| {
            let mut current = action(libc::SIG_DFL, 0);
            // SAFETY: the pointers are valid, and the handler has the type that the flags ask for.
            unsafe {
                libc::sigaction(signal, ptr::null(), &raw mut current) == 0
                    && previous.set(current).is_ok()
                    && libc::sigaction(signal, &raw const ours, ptr::null_mut()) == 0
            }
        })
}

/// Nothing is mapped at the address, or the access is not allowed. Only then there is an address.
fn is_page_fault(info: &libc::siginfo_t) -> bool {
    matches!(info.si_code, 1 | 2)
}

/// By a process. macOS does not tell.
fn was_sent(info: &libc::siginfo_t) -> bool {
    const FIRST_ON_FREEBSD: c_int = 0x10001;
    info.si_code <= 0 || info.si_code >= FIRST_ON_FREEBSD
}

/// # Safety
/// For the kernel.
unsafe extern "C" fn handle(signal: c_int, info: *mut libc::siginfo_t, context: *mut c_void) {
    // SAFETY: the kernel gave us these.
    unsafe {
        let is_handled = is_page_fault(&*info)
            && redirect(
                (*info).si_addr().addr(),
                &mut registers(&mut *context.cast()),
            );
        if !is_handled {
            pass_on(signal, info, context);
        }
    }
}

/// # Safety
/// The arguments are those of a handler.
unsafe fn pass_on(signal: c_int, info: *mut libc::siginfo_t, context: *mut c_void) {
    type Plain = unsafe extern "C" fn(c_int);
    type WithInfo = unsafe extern "C" fn(c_int, *mut libc::siginfo_t, *mut c_void);

    let default = action(libc::SIG_DFL, 0);
    let previous = PREVIOUS[usize::from(signal != SIGNALS[0])].get();
    let previous = previous.unwrap_or(&default);
    let (handler, flags) = (previous.sa_sigaction, previous.sa_flags as c_int);
    let has_handler = handler != libc::SIG_DFL && handler != libc::SIG_IGN;
    // SAFETY: what the kernel would have done.
    unsafe {
        let was_sent = was_sent(&*info);
        if handler == libc::SIG_IGN && was_sent {
            return;
        }
        if !has_handler || flags & libc::SA_RESETHAND != 0 {
            libc::sigaction(signal, &raw const default, ptr::null_mut());
        }
        if !has_handler {
            // Otherwise the instruction faults again.
            if was_sent || cfg!(target_os = "macos") {
                libc::raise(signal);
            }
        } else if flags & libc::SA_SIGINFO != 0 {
            core::mem::transmute::<usize, WithInfo>(handler)(signal, info, context);
        } else {
            core::mem::transmute::<usize, Plain>(handler)(signal);
        }
    }
}

fn word<T>(register: &mut T) -> &mut usize {
    const { assert!(size_of::<T>() == 8 && align_of::<T>() == 8) };
    // SAFETY: an integer of the same size and alignment.
    unsafe { &mut *ptr::from_mut(register).cast() }
}

#[cfg(all(
    any(target_os = "linux", target_os = "android"),
    target_arch = "x86_64"
))]
fn registers(context: &mut libc::ucontext_t) -> Registers<'_> {
    let indices = [libc::REG_RIP, libc::REG_RBP, libc::REG_RSI, libc::REG_RDX];
    let all = &mut context.uc_mcontext.gregs;
    let [pc, fp, second, third] = all.get_disjoint_mut(indices.map(|it| it as usize)).unwrap();
    Registers {
        pc: word(pc),
        fp: *word(fp),
        second_argument: word(second),
        third_argument: word(third),
    }
}

#[cfg(all(
    any(target_os = "linux", target_os = "android"),
    target_arch = "aarch64"
))]
fn registers(context: &mut libc::ucontext_t) -> Registers<'_> {
    let machine = &mut context.uc_mcontext;
    let [_, second, third, .., fp, _] = &mut machine.regs;
    Registers {
        pc: word(&mut machine.pc),
        fp: *word(fp),
        second_argument: word(second),
        third_argument: word(third),
    }
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn registers(context: &mut libc::ucontext_t) -> Registers<'_> {
    // SAFETY: it points into the frame of the signal.
    let state = unsafe { &mut (*context.uc_mcontext).__ss };
    Registers {
        pc: word(&mut state.__rip),
        fp: *word(&mut state.__rbp),
        second_argument: word(&mut state.__rsi),
        third_argument: word(&mut state.__rdx),
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn registers(context: &mut libc::ucontext_t) -> Registers<'_> {
    // SAFETY: it points into the frame of the signal.
    let state = unsafe { &mut (*context.uc_mcontext).__ss };
    let [_, second, third, ..] = &mut state.__x;
    Registers {
        pc: word(&mut state.__pc),
        fp: *word(&mut state.__fp),
        second_argument: word(second),
        third_argument: word(third),
    }
}

#[cfg(all(target_os = "freebsd", target_arch = "x86_64"))]
fn registers(context: &mut libc::ucontext_t) -> Registers<'_> {
    let machine = &mut context.uc_mcontext;
    Registers {
        pc: word(&mut machine.mc_rip),
        fp: *word(&mut machine.mc_rbp),
        second_argument: word(&mut machine.mc_rsi),
        third_argument: word(&mut machine.mc_rdx),
    }
}

#[cfg(all(target_os = "freebsd", target_arch = "aarch64"))]
fn registers(context: &mut libc::ucontext_t) -> Registers<'_> {
    let general = &mut context.uc_mcontext.mc_gpregs;
    let [_, second, third, .., fp] = &mut general.gp_x;
    Registers {
        pc: word(&mut general.gp_elr),
        fp: *word(fp),
        second_argument: word(second),
        third_argument: word(third),
    }
}
