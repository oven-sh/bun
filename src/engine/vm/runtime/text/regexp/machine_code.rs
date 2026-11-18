use bun_engine_asm::Features;
use bun_engine_exec_memory::{CodeHandle, Priority, link};
use bun_engine_macros::native_abi;
use bun_engine_regexp::program::Verified;
use bun_engine_regexp::{Context, Outcome, Racing};
use bun_engine_regexp_jit::{NO_MATCH, Options, Tables, outcome};
use bun_engine_text::{MAX_LENGTH, Text};

use super::captures::Found;
use crate::{Vm, options};

pub(super) struct MachineCode {
    code: CodeHandle,
    tables: Tables,
}

#[derive(Clone, Copy)]
#[repr(C)]
pub(super) struct Results(usize, usize);

impl Results {
    /// Nothing if the search has been given up.
    #[inline(always)]
    pub(super) fn answer(self) -> Option<Found> {
        let (start, end) = (self.0 as u32, self.1 as u32);
        (start.cast_signed() >= NO_MATCH.cast_signed()).then(|| Found::new(start, end))
    }

    pub(super) fn outcome(self) -> Outcome {
        outcome(self.0, self.1)
    }
}

#[native_abi]
type Entry<C> = unsafe fn(*const u8, usize, usize, *mut u32, &mut C) -> Results;

impl MachineCode {
    pub(super) fn is_enabled() -> bool {
        options().use_jit && options().use_regexp_jit
    }

    /// `None` if the program has to stay with the interpreter.
    pub(super) fn new(
        vm: &Vm,
        program: Verified<'_>,
        max_units: Option<u32>,
    ) -> Option<MachineCode> {
        let options = Options {
            features: Features::host(),
            seed: vm.random_seed(),
            max_code_size: options().max_regexp_code_size,
            max_units,
        };
        let mut compiler = vm.regexps().machine_code_compiler.borrow_mut();
        let (code, tables) = compiler.compile(program, &options).ok()?;
        let code = link(code, Priority::Optional, |_| unreachable!()).ok()?;
        Some(MachineCode { code, tables })
    }

    pub(super) fn entry(&self) -> usize {
        self.code.start()
    }

    pub(super) fn size(&self) -> usize {
        self.code.len() + self.tables.size()
    }

    pub(super) fn describe(&self, name: impl FnOnce() -> String) {
        self.code.describe(name);
    }
}

/// # Safety
/// `entry` is that of a `MachineCode` that is alive. Its program is for the width of `subject`, reports no more than
/// `captures` has room for, and goes with that type of context.
#[inline(always)]
unsafe fn call<C>(
    entry: usize,
    subject: Text<'_>,
    start: u32,
    captures: &mut [u32],
    context: &mut C,
) -> Results {
    assert!(subject.len() <= MAX_LENGTH);
    let units = match subject {
        Text::Latin1(characters) => characters.as_ptr(),
        Text::Utf16(units) => units.as_ptr().cast(),
    };
    // SAFETY: the caller's. The code has this type, and the verifier has bounded what it reads.
    unsafe {
        core::mem::transmute::<usize, Entry<C>>(entry)(
            units,
            start as usize,
            subject.len(),
            captures.as_mut_ptr(),
            context,
        )
    }
}

/// # Safety
/// As for `call`. The program does not count turns.
#[inline(always)]
pub(super) unsafe fn enter(
    entry: usize,
    subject: Text<'_>,
    start: u32,
    captures: &mut [u32],
    context: &mut Context,
) -> Results {
    // SAFETY: the caller's.
    unsafe { call(entry, subject, start, captures, context) }
}

/// # Safety
/// As for `call`. The program counts turns.
pub(super) unsafe fn enter_racing(
    entry: usize,
    subject: Text<'_>,
    start: u32,
    captures: &mut [u32],
    racing: &mut Racing<'_>,
) -> Outcome {
    // SAFETY: the caller's.
    unsafe { call(entry, subject, start, captures, racing) }.outcome()
}
