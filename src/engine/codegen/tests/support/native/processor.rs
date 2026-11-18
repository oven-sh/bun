//! Runs machine code from one state of the registers up to where it calls the harness, returns or faults.

use std::cell::Cell;
use std::ffi::{c_int, c_void};
use std::mem::{MaybeUninit, offset_of};
use std::ptr;
use std::sync::{Mutex, MutexGuard, Once, OnceLock, PoisonError};

use bun_engine_asm::{Bank, Fpr, Gpr, Reg};

use super::{ARENA_COUNT, ARENA_SIZE, host, preferred_base, stub};
use crate::support::memory::GRANULE;

#[repr(C)]
pub(super) struct Context {
    fprs: [u128; 32],
    gprs: [u64; 32],
    /// Where to go on. Afterwards the return address, or the instruction that was interrupted.
    pub(super) pc: u64,
    /// The stub through which control came back.
    pub(super) reason: u64,
    host_stack: u64,
    /// The flags are those of a comparison of these.
    pub(super) compared: [u64; 2],
    pub(super) signal: c_int,
    pub(super) fault_address: u64,
    signal_stub: u64,
}

impl Context {
    pub(super) const PC: i32 = offset_of!(Self, pc) as i32;
    pub(super) const REASON: i32 = offset_of!(Self, reason) as i32;
    pub(super) const HOST_STACK: i32 = offset_of!(Self, host_stack) as i32;
    pub(super) const COMPARED: i32 = offset_of!(Self, compared) as i32;

    pub(super) fn offset_of_gpr(reg: Gpr) -> i32 {
        offset_of!(Self, gprs) as i32 + 8 * i32::from(reg.number())
    }

    pub(super) fn offset_of_fpr(reg: Fpr) -> i32 {
        offset_of!(Self, fprs) as i32 + 16 * i32::from(reg.number())
    }

    pub(super) fn gpr(&self, reg: Gpr) -> u64 {
        self.gprs[usize::from(reg.number())]
    }

    pub(super) fn set_gpr(&mut self, reg: Gpr, value: u64) {
        self.gprs[usize::from(reg.number())] = value;
    }

    pub(super) fn get(&self, reg: Reg) -> u128 {
        match reg.bank() {
            Bank::Gpr => self.gpr(reg.gpr()).into(),
            Bank::Fpr => self.fprs[usize::from(reg.fpr().number())],
        }
    }

    pub(super) fn set(&mut self, reg: Reg, value: u128) {
        match reg.bank() {
            Bank::Gpr => self.set_gpr(reg.gpr(), value as u64),
            Bank::Fpr => self.fprs[usize::from(reg.fpr().number())] = value,
        }
    }
}

pub(super) fn read(address: u64, bytes: &mut [u8]) {
    let src = ptr::with_exposed_provenance(address as usize);
    // SAFETY: the harness reads arenas and stacks only.
    unsafe { ptr::copy_nonoverlapping(src, bytes.as_mut_ptr(), bytes.len()) };
}

pub(super) fn write(address: u64, bytes: &[u8]) {
    let dst = ptr::with_exposed_provenance_mut(address as usize);
    // SAFETY: as above.
    unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), dst, bytes.len()) };
}

const READ_WRITE: c_int = libc::PROT_READ | libc::PROT_WRITE;

/// `near` is a hint.
fn map(near: u64, size: u64, protection: c_int) -> u64 {
    let flags = libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_NORESERVE;
    let near = ptr::with_exposed_provenance_mut(near as usize);
    // SAFETY: the system picks an address that is not in use.
    let start = unsafe { libc::mmap(near, size as usize, protection, flags, -1, 0) };
    assert!(start != libc::MAP_FAILED);
    start.expose_provenance() as u64
}

fn protect(granule: u64, protection: c_int) {
    let start = ptr::with_exposed_provenance_mut(granule as usize);
    // SAFETY: a part of an arena, to which Rust has no references.
    let result = unsafe { libc::mprotect(start, GRANULE as usize, protection) };
    assert!(result == 0);
}

/// The memory of `memory::Layout`, and after it the stubs.
pub(super) struct Arena {
    pub(super) base: u64,
    context: Mutex<&'static mut Context>,
}

impl Arena {
    fn new(index: usize) -> Self {
        let wanted = preferred_base(index);
        let mut base = map(wanted, ARENA_SIZE, libc::PROT_NONE);
        if !base.is_multiple_of(GRANULE) {
            base = map(0, ARENA_SIZE + GRANULE, libc::PROT_NONE).next_multiple_of(GRANULE);
        }
        let context = Box::leak(Box::new(Context {
            fprs: [0; 32],
            gprs: [0; 32],
            pc: 0,
            reason: 0,
            host_stack: 0,
            compared: [0; 2],
            signal: 0,
            fault_address: 0,
            signal_stub: stub::address(base, stub::SIGNAL),
        }));
        let code = stub::address(base, 0);
        for granule in [base, base + 2 * GRANULE, code] {
            protect(granule, READ_WRITE);
        }
        let stubs = host::stubs(ptr::from_mut(context).expose_provenance());
        write(code, stubs.bytes());
        protect(code, libc::PROT_READ | libc::PROT_EXEC);
        Self {
            base,
            context: Mutex::new(context),
        }
    }

    pub(super) fn get(index: usize) -> &'static Self {
        static ARENAS: [OnceLock<Arena>; ARENA_COUNT] = [const { OnceLock::new() }; ARENA_COUNT];
        ARENAS[index].get_or_init(|| Self::new(index))
    }

    pub(super) fn lock(&self) -> Processor<'_> {
        Processor {
            context: self.context.lock().unwrap_or_else(PoisonError::into_inner),
            enter: stub::address(self.base, stub::ENTER),
        }
    }
}

pub(super) struct Processor<'a> {
    pub(super) context: MutexGuard<'a, &'static mut Context>,
    enter: u64,
}

thread_local! {
    static RUNNING: Cell<*mut Context> = const { Cell::new(ptr::null_mut()) };
    static TICKS: Cell<u32> = const { Cell::new(0) };
}

impl Processor<'_> {
    pub(super) fn run(&mut self) {
        let context = ptr::from_mut::<Context>(&mut self.context);
        TICKS.set(0);
        RUNNING.set(context);
        // SAFETY: the stub has this type. What it runs is what is being tested, and comes back through a stub.
        unsafe { std::mem::transmute::<usize, host::Enter>(self.enter as usize)(context) };
        RUNNING.set(ptr::null_mut());
    }
}

pub(super) const TICK: c_int = libc::SIGPROF;
const TICK_NANOSECONDS: i64 = 100_000_000;
const TICKS_ALLOWED: u32 = if cfg!(target_arch = "x86_64") { 2 } else { 10 };

extern "C" fn on_signal(signal: c_int, info: *mut libc::siginfo_t, state: *mut c_void) {
    let context = RUNNING.get();
    // SAFETY: the system passes this.
    let state = unsafe { &mut (*state.cast::<libc::ucontext_t>()).uc_mcontext };
    let pc = host::program_counter(state);
    if signal == TICK {
        TICKS.set(TICKS.get() + 1);
        let is_late = TICKS.get() > TICKS_ALLOWED;
        if !is_late || context.is_null() || !bun_engine_exec_memory::contains(pc as usize) {
            return;
        }
    } else if context.is_null() {
        // SAFETY: the instruction faults again, and the process ends.
        unsafe { libc::signal(signal, libc::SIG_DFL) };
        return;
    }
    // SAFETY: `Processor::run` does not touch the context while the code runs, and the system passes `info`.
    let (context, address) = unsafe { (&mut *context, (*info).si_addr()) };
    (context.pc, context.reason) = (pc, stub::SIGNAL as u64);
    (context.signal, context.fault_address) = (signal, address.addr() as u64);
    host::divert(state, context, context.signal_stub);
}

fn handle_signals() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        use libc::{SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGTRAP};
        // SAFETY: zero is valid for every field.
        let mut action = unsafe { MaybeUninit::<libc::sigaction>::zeroed().assume_init() };
        action.sa_sigaction = on_signal as *const () as usize;
        action.sa_flags = libc::SA_SIGINFO | libc::SA_ONSTACK | libc::SA_RESTART;
        for signal in [SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGTRAP, TICK] {
            // SAFETY: the handler touches only the context and variables of the thread that need no setting up.
            let result = unsafe { libc::sigaction(signal, &raw const action, ptr::null_mut()) };
            assert!(result == 0);
        }
    });
}

/// What a thread needs to run code: a stack for it, one for signals, and a clock.
pub(super) struct Thread {
    memory: u64,
    former_signal_stack: libc::stack_t,
    timer: libc::timer_t,
}

const SIGNAL_STACK_SIZE: u64 = 4 * GRANULE;
pub(super) const STACK_SIZE: u64 = 64 << 20;

impl Thread {
    pub(super) fn new() -> Self {
        handle_signals();
        let memory = map(0, SIGNAL_STACK_SIZE + STACK_SIZE, READ_WRITE);
        let stack = libc::stack_t {
            ss_sp: ptr::with_exposed_provenance_mut(memory as usize),
            ss_flags: 0,
            ss_size: SIGNAL_STACK_SIZE as usize,
        };
        let period = libc::timespec {
            tv_sec: 0,
            tv_nsec: TICK_NANOSECONDS,
        };
        let schedule = libc::itimerspec {
            it_interval: period,
            it_value: period,
        };
        let (mut former, mut timer) = (MaybeUninit::uninit(), MaybeUninit::uninit());
        // SAFETY: zero is valid for every field, the memory lasts until `drop`, and the calls fill what they are given.
        unsafe {
            let mut event = MaybeUninit::<libc::sigevent>::zeroed().assume_init();
            event.sigev_notify = libc::SIGEV_THREAD_ID;
            event.sigev_signo = TICK;
            event.sigev_notify_thread_id = libc::gettid();
            assert!(libc::sigaltstack(&raw const stack, former.as_mut_ptr()) == 0);
            let clock = libc::CLOCK_THREAD_CPUTIME_ID;
            assert!(libc::timer_create(clock, &raw mut event, timer.as_mut_ptr()) == 0);
            let timer = timer.assume_init();
            assert!(libc::timer_settime(timer, 0, &raw const schedule, ptr::null_mut()) == 0);
            Self {
                memory,
                former_signal_stack: former.assume_init(),
                timer,
            }
        }
    }

    pub(super) fn stack_end(&self) -> u64 {
        self.memory + SIGNAL_STACK_SIZE + STACK_SIZE
    }
}

impl Drop for Thread {
    fn drop(&mut self) {
        let size = (SIGNAL_STACK_SIZE + STACK_SIZE) as usize;
        // SAFETY: undoes `new`, on the same thread, as the type is not `Send`.
        unsafe {
            libc::timer_delete(self.timer);
            libc::sigaltstack(&raw const self.former_signal_stack, ptr::null_mut());
            libc::munmap(ptr::with_exposed_provenance_mut(self.memory as usize), size);
        }
    }
}
