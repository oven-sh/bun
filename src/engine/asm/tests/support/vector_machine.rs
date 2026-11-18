//! Runs one operation on many operands and watches all registers.

use std::mem::offset_of;
use std::sync::LazyLock;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Code, Features, Options, Scratch, ScratchNeeds};
use bun_engine_exec_memory::{CodeHandle, Priority, link};

use crate::vectors::Random;

const STATE: Gpr = abi::VM;
const CURSOR: Gpr = abi::SAVED_GPRS[0];
const END: Gpr = abi::SAVED_GPRS[1];

#[cfg(target_arch = "x86_64")]
type Entry = unsafe extern "sysv64" fn(*mut State);
#[cfg(target_arch = "aarch64")]
type Entry = unsafe extern "C" fn(*mut State);

#[cfg(target_arch = "x86_64")]
const LINK: RegisterSet = RegisterSet::EMPTY;
#[cfg(target_arch = "aarch64")]
const LINK: RegisterSet = RegisterSet::of(&[bun_engine_asm::arm64::LR], &[]);

const AVAILABLE: RegisterSet = abi::ALL.difference(LINK).difference(RegisterSet::of(
    &[STATE, CURSOR, END, abi::STACK_POINTER, abi::FRAME_POINTER],
    &[],
));

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Registers {
    fprs: [u128; 32],
    gprs: [u64; 32],
}

#[repr(C)]
struct State {
    live: Registers,
    callers: Registers,
    items: *mut Item,
    end: *mut Item,
    code: usize,
}

/// The destination comes first in each bank. One that is not a source starts with junk.
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub(crate) struct Values {
    pub(crate) vectors: [u128; 4],
    pub(crate) scalars: [u64; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Item {
    before: Values,
    after: Values,
}

/// For the destination and then the sources, the first of them that has the same register.
pub(crate) type Aliasing = [usize; 4];

/// All ways in which the first `count` operands can share registers.
pub(crate) fn aliasings(count: usize) -> Vec<Aliasing> {
    let mut all = vec![[0, 1, 2, 3]];
    for operand in 1..count {
        for known in all.clone() {
            for earlier in (0..operand).filter(|&earlier| known[earlier] == earlier) {
                let mut aliasing = known;
                aliasing[operand] = earlier;
                all.push(aliasing);
            }
        }
    }
    all
}

/// For each source, which of the values for the sources it has.
pub(crate) fn sources(aliasing: Aliasing) -> [usize; 3] {
    [1, 2, 3].map(|source| {
        (1..4)
            .find(|&first| aliasing[first] == aliasing[source])
            .unwrap()
            - 1
    })
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Operands {
    pub(crate) fprs: [Fpr; 4],
    pub(crate) gprs: [Gpr; 4],
    scratch: Scratch,
}

fn distinct<const N: usize>(bank: Bank, random: &mut Random) -> [u8; N] {
    let mut left: Vec<_> = AVAILABLE.in_bank(bank).into_iter().collect();
    [(); N].map(|()| (left.swap_remove(random.below(left.len())).index() % 32) as u8)
}

impl Operands {
    /// The second scratch register for integers serves addresses.
    pub(crate) fn new(
        aliasing: Aliasing,
        needs: ScratchNeeds,
        has_address: bool,
        random: &mut Random,
    ) -> Self {
        let mut fprs = distinct::<6>(Bank::Fpr, random);
        // Some instructions take registers that follow each other. More scratch registers than needed may be there.
        let pairs = [(1, 2), (2, 1), (4, 5), (5, 4)];
        let (one, next) = *pairs.get(random.below(10)).unwrap_or(&(0, 0));
        let following = (fprs[one] + 1) % AVAILABLE.in_bank(Bank::Fpr).len() as u8;
        if let Some(taken) = fprs.iter().position(|&number| number == following) {
            fprs[taken] = fprs[next];
        }
        fprs[next] = following;
        let offered = if one < 4 { needs.fprs } else { 2 };
        let fprs = fprs.map(Fpr::new);
        let gprs = distinct::<6>(Bank::Gpr, random).map(Gpr::new);
        Self {
            fprs: aliasing.map(|first| fprs[first]),
            gprs: *gprs.first_chunk().unwrap(),
            scratch: Scratch {
                gprs: [
                    (needs.gprs > 0).then_some(gprs[4]),
                    (needs.gprs > 1 || has_address).then_some(gprs[5]),
                ],
                fprs: [
                    (offered > 0).then_some(fprs[4]),
                    (offered > 1).then_some(fprs[5]),
                ],
            },
        }
    }
}

fn transfer(masm: &mut MacroAssembler, base: Gpr, at: usize, set: RegisterSet, store: bool) {
    for reg in set.fprs() {
        let offset = at + offset_of!(Registers, fprs) + 16 * usize::from(reg.number());
        transfer_vector(masm, Address::new(base, offset as i32), reg, store);
    }
    for reg in set.gprs() {
        let offset = at + offset_of!(Registers, gprs) + 8 * usize::from(reg.number());
        transfer_scalar(masm, Address::new(base, offset as i32), reg, store);
    }
}

fn transfer_vector(masm: &mut MacroAssembler, address: Address, reg: Fpr, store: bool) {
    if store {
        masm.store_vector(address, reg);
    } else {
        masm.load_vector(reg, address);
    }
}

fn transfer_scalar(masm: &mut MacroAssembler, address: Address, reg: Gpr, store: bool) {
    if store {
        masm.store64(address, reg);
    } else {
        masm.load64(reg, address);
    }
}

fn transfer_values(masm: &mut MacroAssembler, at: usize, operands: &Operands, store: bool) {
    // Of the sources that share a register the first is loaded last.
    for index in [0, 3, 2, 1] {
        let vector = Address::new(CURSOR, (at + 16 * index) as i32);
        transfer_vector(masm, vector, operands.fprs[index], store);
        let scalar = at + offset_of!(Values, scalars) + 8 * index;
        let scalar = Address::new(CURSOR, scalar as i32);
        transfer_scalar(masm, scalar, operands.gprs[index], store);
    }
}

fn assembler(features: Features, scratch: Scratch) -> MacroAssembler {
    let mut masm = MacroAssembler::new(Options {
        features,
        shorten_jumps: true,
        seed: 0,
    });
    masm.set_scratch(scratch);
    masm
}

/// Sets all registers, calls the loop over the items, and saves all registers.
static ENTRY: LazyLock<CodeHandle> = LazyLock::new(|| {
    let (gprs, fprs) = ([None; 2], [None; 2]);
    let mut masm = assembler(Features::empty(), Scratch { gprs, fprs });
    let argument = abi::ARGUMENT_GPRS[0];
    let callers = offset_of!(State, callers);
    masm.enter_frame();
    transfer(&mut masm, argument, callers, abi::CALLEE_SAVED, true);
    masm.move64(STATE, argument);
    masm.load64(CURSOR, Address::new(STATE, offset_of!(State, items) as i32));
    masm.load64(END, Address::new(STATE, offset_of!(State, code) as i32));
    transfer(&mut masm, STATE, offset_of!(State, live), AVAILABLE, false);
    masm.call_indirect(END);
    transfer(&mut masm, STATE, offset_of!(State, live), AVAILABLE, true);
    masm.move64(argument, STATE);
    transfer(&mut masm, argument, callers, abi::CALLEE_SAVED, false);
    masm.leave_frame();
    masm.ret();
    install(&masm.finish().unwrap())
});

fn install(code: &Code) -> CodeHandle {
    link(code, Priority::Required, |_| unreachable!()).unwrap()
}

pub(crate) fn assemble(
    features: Features,
    operands: &Operands,
    emit: impl FnOnce(&mut MacroAssembler),
) -> Code {
    let mut masm = assembler(features, operands.scratch);
    masm.load64(END, Address::new(STATE, offset_of!(State, end) as i32));
    let next = masm.here();
    for scratch in operands.scratch.fprs.into_iter().flatten() {
        masm.load_vector(scratch, Address::new(CURSOR, 0));
    }
    transfer_values(&mut masm, offset_of!(Item, before), operands, false);
    emit(&mut masm);
    transfer_values(&mut masm, offset_of!(Item, after), operands, true);
    masm.add64(CURSOR, CURSOR, size_of::<Item>());
    masm.branch64(Cond::Below, CURSOR, END, next);
    masm.ret();
    masm.finish().unwrap()
}

/// Returns what is in the destinations after each item, having checked that nothing else changes.
///
/// # Safety
/// The code is from `assemble` with the same operands, for features that the host has, and what it accesses through
/// the scalars is valid.
pub(crate) unsafe fn run(
    code: &Code,
    operands: &Operands,
    inputs: impl Iterator<Item = Values>,
) -> Vec<(u128, u64)> {
    let items = inputs.map(|before| Item {
        before,
        after: Values::default(),
    });
    let mut items: Vec<Item> = items.collect();
    assert!(!items.is_empty());
    let mut random = Random(items.len() as u64);
    let initial = Registers {
        fprs: [(); 32].map(|()| random.bits()),
        gprs: [(); 32].map(|()| random.next()),
    };
    let (range, code) = (items.as_mut_ptr_range(), install(code));
    let mut state = State {
        live: initial,
        callers: Registers::default(),
        items: range.start,
        end: range.end,
        code: code.start(),
    };
    // SAFETY: the code has this type, keeps what a function has to keep, and otherwise the caller's.
    unsafe { std::mem::transmute::<usize, Entry>(ENTRY.start())(&raw mut state) };

    let mut untouched = AVAILABLE - RegisterSet::of(&operands.gprs, &operands.fprs);
    untouched -= operands.scratch.gprs.into_iter().flatten().collect();
    untouched -= operands.scratch.fprs.into_iter().flatten().collect();
    for number in untouched.fprs().map(|reg| usize::from(reg.number())) {
        assert_eq!(state.live.fprs[number], initial.fprs[number], "f{number}");
    }
    for number in untouched.gprs().map(|reg| usize::from(reg.number())) {
        assert_eq!(state.live.gprs[number], initial.gprs[number], "r{number}");
    }
    let [dst, sources @ ..] = operands.fprs;
    let kept = sources.map(|reg| {
        let first = sources.iter().position(|&other| other == reg).unwrap();
        (reg != dst).then_some(1 + first)
    });
    let results = items.iter().map(|Item { before, after }| {
        for (source, kept) in (1..4).zip(kept) {
            assert!(
                before.scalars[source] == after.scalars[source]
                    && kept.is_none_or(|first| before.vectors[first] == after.vectors[source]),
                "source {source} changes: {operands:?} {before:x?} {after:x?}"
            );
        }
        (after.vectors[0], after.scalars[0])
    });
    results.collect()
}
