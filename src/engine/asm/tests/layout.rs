//! Decodes finished code of both architectures to see that all that refers to a label leads to it.

#[path = "machine/values.rs"]
mod values;

use bun_engine_asm::{
    Arm64Features, Code, FloatAssembly, Gpr, Label, MacroAssembly, Options, RelocationKind, Target,
    Width, X64Features, arm64, x64,
};
use values::Random;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Transfer {
    Jump,
    Call,
    PatchableJump,
    PatchableCall,
    OnFlags,
    OnZero,
    OnBit,
    Address,
}

const TRANSFERS: [Transfer; 8] = [
    Transfer::Jump,
    Transfer::Call,
    Transfer::PatchableJump,
    Transfer::PatchableCall,
    Transfer::OnFlags,
    Transfer::OnZero,
    Transfer::OnBit,
    Transfer::Address,
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Place {
    Inside(u32),
    Outside(Target),
}

trait Architecture: FloatAssembly {
    const REPLACEMENT_JUMP_SIZE: u32;
    const PATCHABLE_MOVE_SIZE: u32;
    /// What follows the address of the table in `jump_table`.
    const JUMP_THROUGH_TABLE_SIZE: u32;
    const NOP_SIZE: usize;

    fn create(shorten_jumps: bool) -> Self;
    fn conditional(&mut self, transfer: Transfer, target: Label);
    fn load_constant(&mut self, bits: u128, size: u8);
    /// Where the instructions in `start..end` lead.
    fn destination(code: &Code, transfer: Transfer, start: u32, end: u32) -> Place;
    /// The offset from which the instructions in `start..end` load.
    fn constant_at(code: &Code, size: u8, start: u32, end: u32) -> u32;
}

fn word(code: &Code, at: u32) -> u32 {
    u32::from_le_bytes(*code.bytes()[at as usize..].first_chunk().unwrap())
}

fn relocation(code: &Code, at: u32, kind: RelocationKind) -> Option<Place> {
    let all = code.relocations();
    let found = all.binary_search_by_key(&at, |relocation| relocation.offset);
    let relocation = all[found.ok()?];
    assert_eq!(relocation.kind, kind);
    Some(Place::Outside(relocation.target))
}

impl Architecture for x64::MacroAssembler {
    const REPLACEMENT_JUMP_SIZE: u32 = x64::patch::REPLACEMENT_JUMP_SIZE as u32;
    const PATCHABLE_MOVE_SIZE: u32 = x64::patch::PATCHABLE_MOVE_SIZE as u32;
    const JUMP_THROUGH_TABLE_SIZE: u32 = 9;
    const NOP_SIZE: usize = 1;

    fn create(shorten_jumps: bool) -> Self {
        Self::new(Options {
            features: X64Features::empty(),
            shorten_jumps,
            seed: 0,
        })
    }

    fn conditional(&mut self, _: Transfer, target: Label) {
        self.assembler().jcc(x64::Cc::G, target);
    }

    fn load_constant(&mut self, bits: u128, size: u8) {
        let constant = self.assembler().constant(bits, size);
        self.assembler()
            .sse_unary_imm(x64::SseUnaryImm::Pshufd, x64::XMM1, constant, 7);
    }

    fn destination(code: &Code, transfer: Transfer, start: u32, end: u32) -> Place {
        let bytes = &code.bytes()[start as usize..end as usize];
        let (short, long): (u8, &[u8]) = match transfer {
            Transfer::Jump | Transfer::PatchableJump => (0xeb, &[0xe9]),
            Transfer::Call | Transfer::PatchableCall => (0, &[0xe8]),
            Transfer::Address => (0, &[0x8d, 0x1d]),
            _ => (0x7f, &[0x0f, 0x8f]),
        };
        if let &[opcode, distance] = bytes {
            assert_eq!(opcode, short);
            return Place::Inside(end.wrapping_add_signed((distance as i8).into()));
        }
        assert!(bytes[..bytes.len() - 4].ends_with(long), "{bytes:x?}");
        relocation(code, end - 4, RelocationKind::Distance32)
            .unwrap_or_else(|| Place::Inside(end.wrapping_add(word(code, end - 4))))
    }

    fn constant_at(code: &Code, size: u8, _: u32, end: u32) -> u32 {
        let at = end + word(code, end - 5);
        assert!(at.is_multiple_of(size.into()));
        at
    }
}

fn signed_field(word: u32, first: u32, count: u32) -> i32 {
    (word << (32 - first - count)) as i32 >> (32 - count)
}

fn unconditional(code: &Code, opcode: u32, at: u32) -> Place {
    let word = word(code, at);
    assert_eq!(word >> 26, opcode);
    relocation(code, at, RelocationKind::Branch26)
        .unwrap_or_else(|| Place::Inside(at.wrapping_add_signed(4 * signed_field(word, 0, 26))))
}

impl Architecture for arm64::MacroAssembler {
    const REPLACEMENT_JUMP_SIZE: u32 = arm64::patch::REPLACEMENT_JUMP_SIZE as u32;
    const PATCHABLE_MOVE_SIZE: u32 = arm64::patch::PATCHABLE_MOVE_SIZE as u32;
    const JUMP_THROUGH_TABLE_SIZE: u32 = 12;
    const NOP_SIZE: usize = 4;

    fn create(shorten_jumps: bool) -> Self {
        Self::new(Options {
            features: Arm64Features::empty(),
            shorten_jumps,
            seed: 0,
        })
    }

    fn conditional(&mut self, transfer: Transfer, target: Label) {
        match transfer {
            Transfer::OnFlags => self.assembler().b_cond(arm64::Cc::Gt, target),
            Transfer::OnZero => self.assembler().cbnz(Width::W64, arm64::X3, target),
            _ => self.assembler().tbz(arm64::X3, 37, target),
        }
    }

    fn load_constant(&mut self, bits: u128, size: u8) {
        self.assembler().ldr_fpr_constant(arm64::V1, bits, size);
    }

    fn destination(code: &Code, transfer: Transfer, start: u32, end: u32) -> Place {
        const B: u32 = 0x05;
        const BL: u32 = 0x25;
        let first = word(code, start);
        let (plain, inverted, bits) = match transfer {
            Transfer::Jump | Transfer::PatchableJump => return unconditional(code, B, end - 4),
            Transfer::Call | Transfer::PatchableCall => return unconditional(code, BL, end - 4),
            Transfer::Address => {
                let distance = signed_field(first, 5, 19) << 2 | (first >> 29 & 3) as i32;
                let dst = first & 31;
                if end - start == 4 {
                    assert_eq!(first & 0x9f00_0000, 0x1000_0000);
                    return Place::Inside(start.wrapping_add_signed(distance));
                }
                let second = word(code, start + 4);
                assert_eq!(first & 0x9f00_0000, 0x9000_0000);
                assert_eq!(second & 0xffc0_03ff, 0x9100_0000 | dst << 5 | dst);
                assert!(code.alignment().is_multiple_of(4096));
                let page = (start & !0xfff).wrapping_add_signed(distance << 12);
                return Place::Inside(page + (second >> 10 & 0xfff));
            }
            Transfer::OnFlags => (0x5400_000c, 0x5400_000d, 19),
            Transfer::OnZero => (0xb500_0003, 0xb400_0003, 19),
            Transfer::OnBit => (0xb628_0003, 0xb728_0003, 14),
        };
        let distance = 4 * signed_field(first, 5, bits);
        let rest = first & !(((1 << bits) - 1) << 5);
        if end - start == 4 {
            assert_eq!(rest, plain);
            return Place::Inside(start.wrapping_add_signed(distance));
        }
        assert_eq!((end - start, rest, distance), (8, inverted, 8));
        unconditional(code, B, start + 4)
    }

    fn constant_at(code: &Code, size: u8, start: u32, end: u32) -> u32 {
        let first = word(code, start);
        assert_eq!(first & 0xff00_001f, u32::from(size / 8) << 30 | 0x1c00_0001);
        let at = start.wrapping_add_signed(4 * signed_field(first, 5, 19));
        if end - start == 4 {
            assert!(at.is_multiple_of(size.into()));
        } else {
            assert_eq!((at, end), (start + 8, at + u32::from(size)));
            assert_eq!(unconditional(code, 0x05, start + 4), Place::Inside(end));
        }
        at
    }
}

enum Item {
    Transfer(Transfer, Label),
    Constant(u128, u8),
    Table(Vec<Label>),
    Aligned(u32, u32),
    PatchableMove,
    Replaceable,
}

struct Program<M> {
    masm: M,
    items: Vec<(Item, Label, Label)>,
    externals: Vec<(Label, Target)>,
    last_point: Option<Label>,
    /// A replaceable point, and a later place that with so many bytes before it is clear of the jump there.
    clearances: Vec<(Label, Label, u32)>,
}

impl<M: Architecture> Program<M> {
    fn new(shorten_jumps: bool) -> Self {
        Self {
            masm: M::create(shorten_jumps),
            items: Vec::new(),
            externals: Vec::new(),
            last_point: None,
            clearances: Vec::new(),
        }
    }

    fn fill(&mut self, bytes: usize) {
        for _ in 0..bytes / M::NOP_SIZE {
            self.masm.nop();
        }
    }

    fn keep_clear(&mut self, label: Label, bytes_before: u32) {
        if let Some(point) = self.last_point {
            self.clearances.push((point, label, bytes_before));
        }
    }

    fn bind(&mut self, label: Label) {
        self.masm.bind(label);
        self.keep_clear(label, 0);
    }

    fn here(&mut self) -> Label {
        let label = self.masm.new_label();
        self.bind(label);
        label
    }

    fn external(&mut self, target: Target) -> Label {
        let label = self.masm.external(target);
        self.externals.push((label, target));
        label
    }

    fn outside(&self, label: Label) -> Option<Target> {
        let found = self.externals.iter().find(|&&(known, _)| known == label);
        found.map(|&(_, target)| target)
    }

    fn alias(&mut self, label: Label, target: Label) {
        self.masm.alias(label, target);
        if let Some(target) = self.outside(target) {
            self.externals.push((label, target));
        }
    }

    fn add(&mut self, item: Item) {
        let (masm, reg) = (&mut self.masm, Gpr::new(3));
        let mut start = masm.mark();
        match item {
            Item::Transfer(Transfer::Jump, target) => masm.jump(target),
            Item::Transfer(Transfer::Call, target) => masm.call(target),
            Item::Transfer(Transfer::PatchableJump, target) => _ = masm.patchable_jump(target),
            Item::Transfer(Transfer::PatchableCall, target) => _ = masm.patchable_call(target),
            Item::Transfer(Transfer::Address, target) => masm.move_label_address(reg, target),
            Item::Transfer(transfer, target) => masm.conditional(transfer, target),
            Item::Constant(bits, size) => masm.load_constant(bits, size),
            Item::Table(ref targets) => masm.jump_table(reg, targets),
            Item::Aligned(alignment, most) => masm.align(alignment, most),
            Item::PatchableMove => _ = masm.patchable_move64(reg, 0),
            Item::Replaceable => start = masm.replaceable_point(),
        }
        let end = masm.mark();
        match item {
            Item::Transfer(Transfer::Call, _) => self.keep_clear(end, 0),
            Item::Transfer(Transfer::PatchableJump | Transfer::PatchableCall, _) => {
                self.keep_clear(end, 4)
            }
            Item::PatchableMove => self.keep_clear(end, M::PATCHABLE_MOVE_SIZE),
            Item::Replaceable => self.last_point = Some(start),
            _ => {}
        }
        self.items.push((item, start, end));
    }

    /// Returns where each item starts and ends.
    fn check(self) -> Vec<(u32, u32)> {
        let places: Vec<Option<Target>> = (self.items.iter())
            .map(|(item, ..)| match *item {
                Item::Transfer(_, target) => self.outside(target),
                _ => None,
            })
            .collect();
        let code = self.masm.finish().unwrap();
        let mut last_point = None;
        let mut extents = Vec::new();
        for ((item, start, end), outside) in self.items.iter().zip(places) {
            let (start, end) = (code.offset_of(*start), code.offset_of(*end));
            let is_clear = last_point.is_none_or(|point| start >= point + M::REPLACEMENT_JUMP_SIZE);
            extents.push((start, end));
            match *item {
                Item::Transfer(transfer, target) => {
                    let mut actual = M::destination(&code, transfer, start, end);
                    if let (Place::Inside(route), Some(_)) = (actual, outside) {
                        actual = M::destination(&code, Transfer::Jump, route, route + 4);
                    }
                    let expected = match outside {
                        Some(target) => Place::Outside(target),
                        None => Place::Inside(code.offset_of(target)),
                    };
                    assert_eq!(actual, expected, "{transfer:?} at {start}");
                    if matches!(transfer, Transfer::PatchableJump | Transfer::PatchableCall) {
                        assert!(end.is_multiple_of(4));
                    }
                }
                Item::Constant(bits, size) => {
                    let at = M::constant_at(&code, size, start, end) as usize;
                    let size = usize::from(size);
                    assert_eq!(code.bytes()[at..at + size], bits.to_le_bytes()[..size]);
                }
                Item::Table(ref targets) => {
                    let end = end - M::JUMP_THROUGH_TABLE_SIZE;
                    let Place::Inside(table) = M::destination(&code, Transfer::Address, start, end)
                    else {
                        panic!("the table is outside");
                    };
                    assert!(table >= code.instructions_end() && table.is_multiple_of(4));
                    for (entry, &target) in (table..).step_by(4).zip(targets) {
                        let actual = table.wrapping_add(word(&code, entry));
                        assert_eq!(actual, code.offset_of(target));
                    }
                }
                Item::Aligned(alignment, most) => {
                    assert!(code.alignment().is_multiple_of(alignment));
                    let needed = start.next_multiple_of(alignment) - start;
                    if is_clear {
                        assert_eq!(end - start, if needed <= most { needed } else { 0 });
                    }
                    assert!(most < alignment - 1 || end.is_multiple_of(alignment));
                }
                Item::PatchableMove => {}
                Item::Replaceable => {
                    assert!(is_clear || last_point == Some(start));
                    last_point = Some(start);
                }
            }
        }
        for (point, later, bytes_before) in self.clearances {
            let jump_end = code.offset_of(point) + M::REPLACEMENT_JUMP_SIZE;
            assert!(code.offset_of(later) - bytes_before >= jump_end);
        }
        let jump_end = last_point.map_or(0, |point| point + M::REPLACEMENT_JUMP_SIZE);
        assert!(code.instructions_end() >= jump_end);
        extents
    }
}

/// `gaps` are the sizes around which the filling between items is chosen, the rarest last.
fn random_program<M: Architecture>(random: &mut Random, items: usize, gaps: &[usize]) {
    let mut program = Program::<M>::new(random.below(2) == 0);
    let mut unbound: Vec<Label> = (0..items / 3 + 1)
        .map(|_| program.masm.new_label())
        .collect();
    let mut inside = unbound.clone();
    let mut outside = Vec::new();
    for index in 0..3 {
        outside.push(program.external(Target::Symbol(index)));
        outside.push(program.external(Target::Address(0x1000 << index)));
    }
    let mut late_aliases = Vec::new();
    for _ in 0..items {
        match random.below(24) {
            0..=9 => {
                let transfer = random.pick(&TRANSFERS);
                let leaves = transfer != Transfer::Address && random.below(5) == 0;
                let target = random.pick(if leaves { &outside } else { &inside });
                program.add(Item::Transfer(transfer, target));
            }
            10..=13 if !unbound.is_empty() => {
                let label = unbound.swap_remove(random.below(unbound.len()));
                program.bind(label);
            }
            14 => inside.push(program.here()),
            15 => {
                let size = random.pick(&[4, 8, 16]);
                let bits = [random.vector(), 5][random.below(2)] >> (128 - 8 * u32::from(size));
                program.add(Item::Constant(bits, size));
            }
            16 => {
                let targets = (0..random.below(5)).map(|_| random.pick(&inside));
                program.add(Item::Table(targets.collect()));
            }
            17 => {
                let alignment = 1 << random.below(7);
                let most = random.pick(&[0, 3, 4, 7, 12, 31, 63, 1000]);
                program.add(Item::Aligned(alignment, most));
            }
            18 => program.add(Item::Replaceable),
            19 => program.add(Item::PatchableMove),
            20 => {
                let labels = if random.below(3) == 0 {
                    &mut outside
                } else {
                    &mut inside
                };
                let (alias, target) = (program.masm.new_label(), random.pick(labels));
                program.alias(alias, target);
                labels.push(alias);
            }
            21 => {
                let alias = program.masm.new_label();
                late_aliases.push((alias, random.pick(&inside)));
                inside.push(alias);
            }
            _ => {
                let rarity = (random.next().trailing_zeros() as usize / 2).min(gaps.len() - 1);
                program.fill(gaps[rarity].saturating_sub(random.below(48)));
            }
        }
    }
    for label in unbound {
        program.bind(label);
    }
    for (alias, target) in late_aliases.into_iter().rev() {
        program.alias(alias, target);
    }
    program.check();
}

fn number_from_environment(name: &str) -> u64 {
    #[allow(clippy::disallowed_methods)]
    std::env::var(name).map_or(1, |text| text.parse().unwrap())
}

fn random_programs<M: Architecture>(count: u64, items: usize, gaps: &[usize]) {
    let mut random = Random(number_from_environment("ASM_TEST_SEED"));
    for _ in 0..count * number_from_environment("ASM_TEST_RUNS") {
        let items = 1 + random.below(items);
        random_program::<M>(&mut random, items, gaps);
    }
}

#[test]
fn random_programs_for_x64() {
    random_programs::<x64::MacroAssembler>(3000, 120, &[8, 48, 130, 300]);
}

#[test]
fn small_random_programs_for_arm64() {
    random_programs::<arm64::MacroAssembler>(1000, 120, &[8, 48]);
}

#[test]
fn medium_random_programs_for_arm64() {
    random_programs::<arm64::MacroAssembler>(200, 200, &[48, 8 << 10, 16 << 10, 32 << 10]);
}

#[test]
fn large_random_programs_for_arm64() {
    random_programs::<arm64::MacroAssembler>(12, 200, &[48, 256 << 10, 512 << 10, 1 << 20]);
}

fn ending_with_a_replaceable_point<M: Architecture>() {
    for has_data in [false, true] {
        let mut program = Program::<M>::new(has_data);
        let outside = program.external(Target::Symbol(0));
        program.add(Item::Transfer(Transfer::OnFlags, outside));
        if has_data {
            program.add(Item::Constant(1, 8));
        }
        program.add(Item::Replaceable);
        let point = program.items.last().unwrap().1;
        let code = program.masm.finish().unwrap();
        let (point, size) = (code.offset_of(point), M::REPLACEMENT_JUMP_SIZE);
        assert!(code.instructions_end() >= point + size);
        assert!(code.relocations()[0].offset.abs_diff(point) >= 4);
    }
}

#[test]
fn a_jump_fits_at_the_end_of_the_code() {
    ending_with_a_replaceable_point::<x64::MacroAssembler>();
    ending_with_a_replaceable_point::<arm64::MacroAssembler>();
}

#[test]
fn x64_jumps_are_short_exactly_when_they_reach() {
    for transfer in [Transfer::Jump, Transfer::OnFlags] {
        for shorten_jumps in [false, true] {
            for gap in 120..135 {
                let mut program = Program::<x64::MacroAssembler>::new(shorten_jumps);
                let (behind, ahead) = (program.here(), program.masm.new_label());
                program.fill(gap);
                program.add(Item::Transfer(transfer, behind));
                program.add(Item::Transfer(transfer, ahead));
                program.fill(gap);
                program.bind(ahead);
                let extents = program.check();
                let is_short = |index: usize| extents[index].1 - extents[index].0 == 2;
                assert_eq!(is_short(0), gap + 2 <= 128);
                assert_eq!(is_short(1), shorten_jumps && gap <= 127);
            }
        }
    }
}

#[test]
fn x64_jumps_reach_over_jumps_that_shrink() {
    for count in [63, 64] {
        let mut program = Program::<x64::MacroAssembler>::new(true);
        program.fill(300);
        let (behind, ahead) = (program.here(), program.masm.new_label());
        for _ in 0..count {
            program.add(Item::Transfer(Transfer::OnFlags, ahead));
        }
        program.bind(ahead);
        program.add(Item::Transfer(Transfer::OnFlags, behind));
        let extents = program.check();
        let short = extents.iter().filter(|(start, end)| end - start == 2);
        assert_eq!(short.count(), 64);
    }
}

/// A row of items on each side of the gap, each a little further from what it refers to on the other side.
fn arm64_reach(reach: u32, item: impl Fn(Label) -> Item) {
    const ROW: usize = 24;
    let mut program = Program::<arm64::MacroAssembler>::new(false);
    let ahead = program.masm.new_label();
    for _ in 0..ROW {
        program.add(item(ahead));
    }
    let behind = program.here();
    program.fill(reach as usize - 2 * ROW);
    program.bind(ahead);
    for _ in 0..ROW {
        program.add(item(behind));
    }
    let extents = program.check();
    let (behind, ahead) = (extents[ROW - 1].1, extents[ROW].0);
    let (mut short, mut long) = (0, 0);
    for (index, &(start, end)) in extents.iter().enumerate() {
        let distance = start.abs_diff(if index < ROW { ahead } else { behind });
        if end - start == 4 {
            short += 1;
        } else {
            assert!(distance > reach);
            long += 1;
        }
    }
    assert!(short >= ROW / 2 && long >= ROW / 2);
}

#[test]
fn arm64_tests_of_a_bit_reach_32_kib() {
    arm64_reach((32 << 10) - 4, |to| Item::Transfer(Transfer::OnBit, to));
}

#[test]
fn arm64_conditional_branches_reach_1_mib() {
    arm64_reach((1 << 20) - 4, |to| Item::Transfer(Transfer::OnFlags, to));
    arm64_reach((1 << 20) - 4, |to| Item::Transfer(Transfer::OnZero, to));
}

#[test]
fn arm64_addresses_reach_1_mib() {
    arm64_reach((1 << 20) - 4, |to| Item::Transfer(Transfer::Address, to));
}

#[test]
fn arm64_addresses_out_of_reach_are_anywhere_in_a_page() {
    let mut program = Program::<arm64::MacroAssembler>::new(false);
    let mut labels = Vec::new();
    for _ in 0..40 {
        labels.push(program.here());
        program.fill(500);
    }
    program.fill(1 << 20);
    for label in labels {
        program.add(Item::Transfer(Transfer::Address, label));
        program.fill(500);
    }
    assert!(program.check().iter().all(|(start, end)| end - start == 8));
}

#[test]
fn arm64_branches_that_push_each_other_out_of_reach_one_by_one() {
    const COUNT: usize = 60_000;
    const SPANNED: usize = 2731;
    let mut program = Program::<arm64::MacroAssembler>::new(false);
    let labels: Vec<Label> = (0..COUNT).map(|_| program.masm.new_label()).collect();
    let far = program.masm.new_label();
    for index in 0..COUNT {
        program.bind(labels[index]);
        let target = labels.get(index + SPANNED).copied().unwrap_or(far);
        program.add(Item::Transfer(Transfer::OnBit, target));
        program.fill(4);
    }
    let near = program.here();
    for _ in 0..500 {
        program.add(Item::Aligned(64, 63));
        program.add(Item::Transfer(Transfer::OnBit, near));
        program.add(Item::Constant(1, 16));
    }
    program.add(Item::Transfer(Transfer::Jump, near));
    program.add(Item::Table(vec![near, far]));
    program.fill(32 << 10);
    program.bind(far);
    let sizes: Vec<u32> = program
        .check()
        .iter()
        .map(|(start, end)| end - start)
        .collect();
    assert!(sizes[..COUNT].iter().all(|&size| size == 8));
    assert!(
        sizes[COUNT..]
            .chunks(3)
            .take(100)
            .all(|sizes| sizes[1..] == [4, 4])
    );
}

fn long_chain_of_aliases<M: Architecture>() {
    const COUNT: usize = 100_000;
    let mut program = Program::<M>::new(true);
    let labels: Vec<Label> = (0..COUNT).map(|_| program.masm.new_label()).collect();
    for pair in labels.array_windows::<2>() {
        program.alias(pair[0], pair[1]);
        program.add(Item::Transfer(Transfer::Jump, labels[0]));
        program.add(Item::Transfer(Transfer::OnFlags, pair[0]));
    }
    program.bind(labels[COUNT - 1]);
    program.check();
}

#[test]
fn long_chains_of_aliases() {
    long_chain_of_aliases::<x64::MacroAssembler>();
    long_chain_of_aliases::<arm64::MacroAssembler>();
}

#[test]
fn patches_for_arm64() {
    use arm64::patch::{REACH, move_bytes, transfer_target, transfer_word};
    let moving = |value| {
        let mut masm = arm64::MacroAssembler::create(false);
        masm.patchable_move64(arm64::X9, value);
        *masm.finish().unwrap().bytes().as_array().unwrap()
    };
    let values = [0, u64::MAX, 0x1234_5678_9abc_def0, 0x8001_8001_8001_8001];
    for (old, new) in values.into_iter().flat_map(|a| values.map(|b| (a, b))) {
        assert_eq!(move_bytes(moving(old), new), moving(new));
    }
    let (call, from) = (0x9400_0123, 1 << 40);
    for to in [from, from + 4, from - 4, from + REACH, from - REACH] {
        let word = transfer_word(call, from, to).unwrap();
        assert_eq!((word >> 26, transfer_target(word, from)), (call >> 26, to));
    }
    assert_eq!(transfer_word(call, from, from + REACH + 4), None);
    assert_eq!(transfer_word(call, from, from - REACH - 8), None);
}

#[test]
fn arm64_constants_and_tables_out_of_reach() {
    let mut program = Program::<arm64::MacroAssembler>::new(false);
    let (behind, ahead) = (program.here(), program.masm.new_label());
    for index in 0..30 {
        program.add(Item::Constant(index, [4, 8, 16][index as usize % 3]));
        program.add(Item::Table(vec![ahead, behind]));
    }
    program.fill((1 << 20) - 600);
    program.bind(ahead);
    let extents = program.check();
    let constants = || extents.iter().step_by(2).map(|(start, end)| end - start);
    assert!(constants().any(|size| size == 4) && constants().any(|size| size == 24));
}

#[test]
#[ignore = "fills 128 MiB"]
fn arm64_code_of_the_greatest_size() {
    let program = |excess: usize| {
        let mut program = Program::<arm64::MacroAssembler>::new(false);
        let (behind, ahead) = (program.here(), program.masm.new_label());
        for transfer in TRANSFERS {
            program.add(Item::Transfer(transfer, ahead));
        }
        program.fill(arm64::patch::REACH - 96 + excess);
        for transfer in TRANSFERS {
            program.add(Item::Transfer(transfer, behind));
        }
        program.bind(ahead);
        program
    };
    let extents = program(0).check();
    assert_eq!(extents.last().unwrap().1 as usize, arm64::patch::REACH);
    for excess in [4, 40, 4000] {
        assert!(program(excess).masm.finish().is_err());
    }
}
