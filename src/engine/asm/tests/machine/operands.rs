//! Choices of registers, constants and addresses.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Memory, RegOrImm, RegOrMem, Src};

use super::values::Random;
use super::{Harness, host};

pub(crate) const SP: Gpr = abi::STACK_POINTER;

pub(crate) const CONSTANTS: [i64; 64] = [
    0,
    1,
    2,
    3,
    5,
    6,
    7,
    9,
    0x55,
    0x7f,
    0x80,
    0x81,
    0xff,
    0x100,
    0xfff,
    0x1000,
    0x1001,
    0x7fff,
    0x8000,
    0xdfff,
    0xff00,
    0xffff,
    0x1_0000,
    0x1_f600,
    0x12_3456,
    0xff_f000,
    0xff_ffff,
    0x100_0000,
    0x1234_5678,
    0x5555_5555,
    0x7fff_ffff,
    0x8000_0000,
    0x8000_0001,
    0xf000_000f,
    0xff00_0000,
    0xffff_fff0,
    0xffff_ffff,
    0x1_0000_0000,
    0x1_0000_0001,
    0x12_0000_0000,
    0x7f12_3456_7890,
    0x00ff_0000_0000_0000,
    0x5555_5555_5555_5555,
    0x1234_5678_9abc_def0,
    0x4000_0000_0000_0000,
    i64::MAX,
    i64::MIN,
    i64::MIN + 1,
    -1,
    -2,
    -3,
    -7,
    -16,
    -0x80,
    -0x81,
    -0xfff,
    -0x1000,
    -0x1001,
    -0x12_3456,
    -0xff_f001,
    -0x100_0000,
    -0x8000_0000,
    -0x8000_0001,
    0xfffe_0000_0000_0002_u64 as i64,
];

pub(crate) const OFFSETS: [i32; 46] = [
    0,
    1,
    4,
    8,
    16,
    127,
    128,
    252,
    255,
    256,
    257,
    504,
    512,
    1008,
    1024,
    4088,
    4095,
    4096,
    4097,
    4104,
    8190,
    32_760,
    32_768,
    65_520,
    65_536,
    0x1_2348,
    0x1_2349,
    0xff_f000,
    0xff_fff8,
    0x100_0000,
    0x1234_5678,
    i32::MAX - 15,
    -1,
    -8,
    -128,
    -129,
    -256,
    -257,
    -512,
    -1024,
    -4096,
    -0x1_2348,
    -0xff_f000,
    -0x100_0008,
    -0x1234_5679,
    i32::MIN,
];

pub(crate) const SCALES: [Scale; 4] = [Scale::One, Scale::Two, Scale::Four, Scale::Eight];

/// Each way in which `count` operands can coincide, as the number of the group of each.
fn groupings(count: usize) -> Vec<Vec<usize>> {
    let mut all = vec![Vec::new()];
    for _ in 0..count {
        let longer = all.iter().flat_map(|groups: &Vec<usize>| {
            let used = groups.iter().max().map_or(0, |last| last + 1);
            (0..=used).map(move |group| [&groups[..], &[group]].concat())
        });
        all = longer.collect();
    }
    all
}

/// Each way to give some of the groups one of the special registers.
fn placements<R: Copy>(groups: usize, special: &[R]) -> Vec<Vec<Option<R>>> {
    let mut all = vec![vec![None; groups]];
    for &reg in special {
        for index in 0..all.len() {
            for group in 0..groups {
                let mut placed = all[index].clone();
                if placed[group].replace(reg).is_none() {
                    all.push(placed);
                }
            }
        }
    }
    all
}

fn patterns<R: Copy + PartialEq>(
    count: usize,
    special: &[R],
    pool: &[R],
    random: &mut Random,
) -> Vec<Vec<R>> {
    let mut all = Vec::new();
    for grouping in groupings(count) {
        let groups = grouping.iter().max().map_or(0, |last| last + 1);
        for placed in placements(groups, special) {
            let mut free: Vec<R> = pool.to_vec();
            free.retain(|reg| !special.contains(reg));
            let mut take = || free.swap_remove(random.below(free.len()));
            let chosen: Vec<R> = placed
                .into_iter()
                .map(|reg| reg.unwrap_or_else(&mut take))
                .collect();
            all.push(grouping.iter().map(|&group| chosen[group]).collect());
        }
    }
    all
}

pub(crate) fn operand_registers() -> RegisterSet {
    let scratch = Harness::default_scratch();
    let mut all = abi::ALL;
    all.remove(SP);
    for &reg in host::UNCHECKED.iter().chain(scratch.gprs.iter().flatten()) {
        all.remove(reg);
    }
    for &reg in scratch.fprs.iter().flatten() {
        all.remove(reg);
    }
    all
}

fn split<const N: usize>(registers: &[Gpr]) -> ([Gpr; N], &[Gpr]) {
    let (first, rest) = registers.split_at(N);
    (first.try_into().unwrap(), rest)
}

impl Harness {
    fn gpr_patterns(&mut self, count: usize, special: &[Gpr]) -> Vec<Vec<Gpr>> {
        let pool: Vec<Gpr> = self.operand_registers.gprs().collect();
        patterns(count, special, &pool, &mut self.random)
    }

    /// Every way in which the operands can coincide with each other and with `special`.
    pub(crate) fn gprs_with<const N: usize>(&mut self, special: &[Gpr]) -> Vec<[Gpr; N]> {
        let all = self.gpr_patterns(N, special);
        all.iter().map(|registers| split(registers).0).collect()
    }

    pub(crate) fn gprs<const N: usize>(&mut self) -> Vec<[Gpr; N]> {
        self.gprs_with(&[])
    }

    pub(crate) fn fprs<const N: usize>(&mut self) -> Vec<[Fpr; N]> {
        let pool: Vec<Fpr> = self.operand_registers.fprs().collect();
        let all = patterns(N, &[], &pool, &mut self.random);
        all.into_iter()
            .map(|registers| registers.try_into().unwrap())
            .collect()
    }

    pub(crate) fn any_gpr(&mut self) -> Gpr {
        self.gprs::<1>()[0][0]
    }

    pub(crate) fn any_fpr(&mut self) -> Fpr {
        self.fprs::<1>()[0][0]
    }

    /// With `N` other registers, in every way in which all can coincide. Each gets `variety` of the offsets.
    pub(crate) fn addresses<const N: usize>(
        &mut self,
        special: &[Gpr],
        variety: usize,
    ) -> Vec<([Gpr; N], Address)> {
        let mut all = Vec::new();
        for (has_base, has_index) in [(true, false), (true, true), (false, false), (false, true)] {
            let count = N + usize::from(has_base) + usize::from(has_index);
            let first = self.random.below(OFFSETS.len());
            for step in 0..variety.min(OFFSETS.len()) {
                for registers in self.gpr_patterns(count, special) {
                    let (others, own) = split(&registers);
                    let base = if has_base { own[0] } else { SP };
                    let offset = if variety >= OFFSETS.len() {
                        OFFSETS[(first + step) % OFFSETS.len()]
                    } else {
                        self.random.pick(&OFFSETS)
                    };
                    if has_index {
                        let (index, scale) = (own[own.len() - 1], self.random.pick(&SCALES));
                        all.push((others, Address::indexed(base, index, scale, offset)));
                    } else if has_base || Self::is_on_stack(offset) {
                        all.push((others, Address::new(base, offset)));
                    }
                }
            }
        }
        all
    }

    pub(crate) fn memories<const N: usize>(&mut self, variety: usize) -> Vec<([Gpr; N], Memory)> {
        let addresses = self.addresses(&[], variety).into_iter();
        let mut all: Vec<_> = addresses
            .map(|(others, address)| (others, address.into()))
            .collect();
        for address in self.absolute_addresses() {
            all.extend(
                self.gprs()
                    .into_iter()
                    .map(|others| (others, address.into())),
            );
        }
        all
    }

    pub(crate) fn registers_or_constants<const N: usize>(&mut self) -> Vec<([Gpr; N], RegOrImm)> {
        let mut all = Vec::new();
        for _ in 0..3 {
            for registers in self.gpr_patterns(N + 1, &[]) {
                let (others, own) = split(&registers);
                all.push((others, RegOrImm::Reg(own[0])));
            }
        }
        for constant in CONSTANTS {
            // With many registers each constant gets some of the patterns.
            let patterns = self.gprs::<N>();
            let stride = patterns.len().div_ceil(2);
            let first = self.random.below(stride);
            for &others in patterns.iter().skip(first).step_by(stride) {
                all.push((others, RegOrImm::Imm(constant)));
                all.push((others, RegOrImm::Untrusted(constant)));
            }
        }
        all
    }

    pub(crate) fn sources<const N: usize>(&mut self) -> Vec<([Gpr; N], Src)> {
        let direct = self.registers_or_constants().into_iter();
        let memories = self.memories(2).into_iter();
        direct
            .map(|(others, src)| (others, src.into()))
            .chain(memories.map(|(others, memory)| (others, memory.into())))
            .collect()
    }

    pub(crate) fn registers_or_memories<const N: usize>(&mut self) -> Vec<([Gpr; N], RegOrMem)> {
        let memories = self.memories(2).into_iter();
        let mut all: Vec<_> = memories
            .map(|(others, memory)| (others, memory.into()))
            .collect();
        for registers in self.gpr_patterns(N + 1, &[]) {
            let (others, own) = split(&registers);
            all.push((others, RegOrMem::Reg(own[0])));
        }
        all
    }

    /// Memory, and what can be stored to it or compared with it.
    pub(crate) fn memories_and_operands<const N: usize, const AND_ONE: usize>(
        &mut self,
    ) -> Vec<([Gpr; N], Memory, RegOrImm)> {
        assert!(AND_ONE == N + 1);
        let mut all = Vec::new();
        for (registers, memory) in self.memories::<AND_ONE>(2) {
            let (others, own) = split(&registers);
            all.push((others, memory, RegOrImm::Reg(own[0])));
        }
        for constant in CONSTANTS {
            let memories = self.memories::<N>(1);
            for _ in 0..3 {
                let (others, memory) = self.random.pick(&memories);
                all.push((others, memory, RegOrImm::Imm(constant)));
                let (others, memory) = self.random.pick(&memories);
                all.push((others, memory, RegOrImm::Untrusted(constant)));
            }
        }
        all
    }
}
