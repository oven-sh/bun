//! The bytes, labels and unresolved references of code that is being assembled.

use core::mem;

use crate::label::{Code, CodeTooLarge, Label, LabelState, Relocation, Target, resolve};

/// Longer than any instruction plus the widest single write.
pub(crate) const WINDOW: usize = 32;

const INITIAL_CAPACITY: usize = 512;
/// A guess at how often labels are made and used.
const BYTES_FOR_EACH_REFERENCE: usize = 16;
const MINIMUM_ALIGNMENT: u32 = 16;

/// Bytes that depend on where a label ends up. `Kind` is the architecture's.
#[derive(Clone, Copy)]
pub(crate) struct Site<Kind> {
    pub(crate) at: u32,
    pub(crate) label: Label,
    pub(crate) kind: Kind,
}

#[derive(Clone, Copy)]
pub(crate) struct Constant {
    pub(crate) bits: u128,
    pub(crate) size: u8,
    pub(crate) label: Label,
}

pub(crate) struct JumpTable {
    pub(crate) label: Label,
    pub(crate) targets_end: u32,
}

pub(crate) struct CodeBuffer<Kind> {
    /// Initialized beyond `len`, so that an instruction is written with one check of the bounds.
    pub(crate) bytes: Vec<u8>,
    pub(crate) len: u32,
    pub(crate) labels: Vec<LabelState>,
    pub(crate) sites: Vec<Site<Kind>>,
    pub(crate) externals: Vec<Target>,
    pub(crate) relocations: Vec<Relocation>,
    aliases: Vec<Label>,
    pub(crate) aliases_external: bool,
    pub(crate) constants: Vec<Constant>,
    pub(crate) tables: Vec<JumpTable>,
    pub(crate) table_targets: Vec<Label>,
    pub(crate) alignment: u32,
    /// Up to here a jump may be written over the code, so control does not enter.
    pub(crate) replaceable_end: u32,
    pub(crate) limit: usize,
    pub(crate) overflowed: bool,
}

impl<Kind: Copy> CodeBuffer<Kind> {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            bytes: vec![0; INITIAL_CAPACITY],
            len: 0,
            labels: Vec::with_capacity(INITIAL_CAPACITY / BYTES_FOR_EACH_REFERENCE),
            sites: Vec::with_capacity(INITIAL_CAPACITY / BYTES_FOR_EACH_REFERENCE),
            externals: Vec::new(),
            relocations: Vec::new(),
            aliases: Vec::new(),
            aliases_external: false,
            constants: Vec::new(),
            tables: Vec::new(),
            table_targets: Vec::new(),
            alignment: MINIMUM_ALIGNMENT,
            replaceable_end: 0,
            limit,
            overflowed: false,
        }
    }

    pub(crate) fn restart(&mut self, spent: Option<Code>) {
        if let Some(spent) = spent {
            (self.bytes, self.labels) = (spent.bytes, spent.labels);
            self.relocations = spent.relocations;
        }
        self.len = 0;
        self.labels.clear();
        self.relocations.clear();
        self.sites.clear();
        self.externals.clear();
        self.aliases.clear();
        self.aliases_external = false;
        self.constants.clear();
        self.tables.clear();
        self.table_targets.clear();
        self.alignment = MINIMUM_ALIGNMENT;
        self.replaceable_end = 0;
        self.overflowed = false;
        if self.bytes.len() < INITIAL_CAPACITY {
            self.bytes.resize(INITIAL_CAPACITY, 0);
        }
    }

    /// All distances are filled in. The instructions end at `end`.
    pub(crate) fn take_code(&mut self, end: Label) -> Code {
        Code {
            instructions_end: self.labels[end.0 as usize].offset,
            bytes: mem::take(&mut self.bytes),
            len: self.len,
            labels: mem::take(&mut self.labels),
            relocations: mem::take(&mut self.relocations),
            alignment: self.alignment,
        }
    }

    pub(crate) fn reserve(&mut self, additional: usize) {
        let wanted = (self.len as usize + additional.min(self.limit)).min(self.limit) + WINDOW;
        if wanted > self.bytes.len() {
            let references = (wanted - self.bytes.len()) / BYTES_FOR_EACH_REFERENCE;
            self.labels.reserve(references);
            self.sites.reserve(references);
            if self.len == 0 {
                // Pages that are new are not touched until they are written.
                self.bytes = vec![0; wanted];
            } else {
                self.bytes.resize(wanted, 0);
            }
        }
    }

    #[inline(always)]
    pub(crate) fn window(&mut self) -> &mut [u8; WINDOW] {
        while self.len as usize + WINDOW > self.bytes.len() {
            self.grow();
        }
        let at = self.len as usize;
        self.bytes[at..at + WINDOW].as_mut_array().unwrap()
    }

    /// Past the limit the code is lost, so what follows is written over it and `finish` fails.
    #[cold]
    #[inline(never)]
    fn grow(&mut self) {
        if self.len as usize > self.limit {
            self.overflowed = true;
            self.len = 0;
            self.replaceable_end = 0;
            return;
        }
        let capacity = (self.bytes.len() * 2).min(self.limit + 2 * WINDOW);
        self.bytes.resize(capacity, 0);
    }

    pub(crate) fn check_size(&self) -> Result<(), CodeTooLarge> {
        if self.overflowed || self.len as usize > self.limit {
            Err(CodeTooLarge)
        } else {
            Ok(())
        }
    }

    #[inline(always)]
    pub(crate) fn put<const N: usize>(&mut self, bytes: [u8; N]) {
        self.put_first(bytes, N as u32);
    }

    /// Only `count` of the bytes are kept.
    #[inline(always)]
    pub(crate) fn put_first<const N: usize>(&mut self, bytes: [u8; N], count: u32) {
        let at = self.len as usize;
        match self.bytes.get_mut(at..at + N) {
            Some(room) => {
                room.copy_from_slice(&bytes);
                self.len += count;
            }
            None => self.grow_and_put(bytes, count),
        }
    }

    #[cold]
    #[inline(never)]
    fn grow_and_put<const N: usize>(&mut self, bytes: [u8; N], count: u32) {
        self.grow();
        self.put_first(bytes, count);
    }

    #[inline]
    fn push_label(&mut self, offset: u32, link: u32) -> Label {
        let label = Label(self.labels.len() as u32);
        self.labels.push(LabelState { offset, link });
        label
    }

    #[inline]
    pub(crate) fn new_label(&mut self) -> Label {
        self.push_label(LabelState::UNBOUND, 0)
    }

    #[inline]
    pub(crate) fn mark(&mut self) -> Label {
        self.push_label(self.len, self.sites.len() as u32)
    }

    #[inline]
    pub(crate) fn external(&mut self, target: Target) -> Label {
        self.externals.push(target);
        Label(Label::EXTERNAL | (self.externals.len() as u32 - 1))
    }

    #[inline]
    pub(crate) fn bind(&mut self, label: Label) {
        let state = &mut self.labels[label.0 as usize];
        assert!(
            state.offset == LabelState::UNBOUND,
            "the label is bound twice"
        );
        *state = LabelState {
            offset: self.len,
            link: self.sites.len() as u32,
        };
    }

    pub(crate) fn alias(&mut self, label: Label, target: Label) {
        let target = self.end_of_aliases(target);
        assert!(label != target, "the label stands for itself");
        let state = &mut self.labels[label.0 as usize];
        assert!(
            state.offset == LabelState::UNBOUND,
            "the label is bound twice"
        );
        *state = LabelState {
            offset: LabelState::ALIAS,
            link: target.0,
        };
        self.aliases.push(label);
        self.aliases_external |= target.is_external();
    }

    /// Makes all on the way refer to it, so that no chain is followed twice.
    #[cold]
    fn end_of_aliases(&mut self, mut label: Label) -> Label {
        let mut end = label;
        while let state = resolve(&self.labels, end)
            && state.offset == LabelState::ALIAS
        {
            end = Label(state.link);
        }
        while label != end {
            label = Label(core::mem::replace(
                &mut self.labels[label.0 as usize].link,
                end.0,
            ));
        }
        end
    }

    #[inline]
    pub(crate) fn state(&mut self, label: Label) -> LabelState {
        let state = resolve(&self.labels, label);
        if state.offset != LabelState::ALIAS {
            return state;
        }
        let end = self.end_of_aliases(label);
        resolve(&self.labels, end)
    }

    /// Gives each alias the state of what it stands for, which does not change any more.
    pub(crate) fn settle_aliases(&mut self) {
        for alias in core::mem::take(&mut self.aliases) {
            self.labels[alias.0 as usize] = self.state(alias);
        }
    }

    #[inline]
    pub(crate) fn record(&mut self, at: u32, label: Label, kind: Kind) {
        self.sites.push(Site { at, label, kind });
    }

    /// An instruction of `count` bytes with a site `skipped` bytes from its start.
    #[inline(always)]
    pub(crate) fn put_with_site<const N: usize>(
        &mut self,
        bytes: [u8; N],
        count: u32,
        skipped: u32,
        label: Label,
        kind: Kind,
    ) {
        if self.sites.len() == self.sites.capacity() {
            return self.grow_and_put_with_site(bytes, count, skipped, label, kind);
        }
        self.record(self.len + skipped, label, kind);
        self.put_first(bytes, count);
    }

    #[cold]
    #[inline(never)]
    fn grow_and_put_with_site<const N: usize>(
        &mut self,
        bytes: [u8; N],
        count: u32,
        skipped: u32,
        label: Label,
        kind: Kind,
    ) {
        self.record(self.len + skipped, label, kind);
        self.put_first(bytes, count);
    }

    pub(crate) fn require_alignment(&mut self, alignment: u32) {
        assert!(alignment.is_power_of_two());
        self.alignment = self.alignment.max(alignment);
    }

    /// The label of the low `size` bytes of `bits`, which are placed after the instructions.
    pub(crate) fn constant(&mut self, bits: u128, size: u8) -> Label {
        const RECENT: usize = 16;
        let recent = &self.constants[self.constants.len().saturating_sub(RECENT)..];
        if let Some(found) = recent
            .iter()
            .find(|constant| constant.bits == bits && constant.size == size)
        {
            return found.label;
        }
        let label = self.new_label();
        self.constants.push(Constant { bits, size, label });
        label
    }

    pub(crate) fn jump_table(&mut self, targets: &[Label]) -> Label {
        let label = self.new_label();
        self.table_targets.extend_from_slice(targets);
        self.tables.push(JumpTable {
            label,
            targets_end: self.table_targets.len() as u32,
        });
        label
    }

    /// Follows the instructions, at a multiple of 16. `entry` is the kind of site for a word of the table at a label.
    pub(crate) fn put_data(&mut self, entry: impl Fn(Label) -> Kind) {
        let constants = mem::take(&mut self.constants);
        for size in [16, 8, 4] {
            for constant in constants.iter().filter(|constant| constant.size == size) {
                self.bind(constant.label);
                self.put_first(constant.bits.to_le_bytes(), size.into());
            }
        }
        self.constants = constants;
        let mut first = 0;
        for table in mem::take(&mut self.tables) {
            self.bind(table.label);
            for index in first..table.targets_end as usize {
                self.record(self.len, self.table_targets[index], entry(table.label));
                self.put([0; 4]);
            }
            first = table.targets_end as usize;
        }
    }

    pub(crate) fn has_data(&self) -> bool {
        !self.constants.is_empty() || !self.tables.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        Address, Arm64Features, Cond, FloatAssembly, FloatWidth, Fpr, Gpr, MacroAssembly, Options,
        TestCond, X64Features, arm64, x64,
    };

    fn emit(masm: &mut impl FloatAssembly, rounds: u32, gap: u32) {
        let (a, b, float) = (Gpr::new(1), Gpr::new(3), Fpr::new(2));
        let (start, end, outside) = (masm.here(), masm.new_label(), masm.external_address(64));
        for round in 0..rounds {
            let (here, ahead, alias) = (masm.here(), masm.new_label(), masm.new_label());
            masm.branch_test_bit64(TestCond::Zero, a, 40, end);
            masm.branch64(Cond::Lt, a, b, ahead);
            masm.branch64(Cond::Eq, Address::new(a, 0x12345), i64::MAX, outside);
            masm.min_f64(float, float, float);
            masm.move_float_constant(FloatWidth::F64, float, 0x1234_5678_9abc + u64::from(round));
            masm.replaceable_point();
            masm.patchable_jump(alias);
            masm.align(32, round);
            masm.bind(ahead);
            masm.alias(alias, start);
            masm.move_label_address(a, end);
            masm.patchable_move64(b, 1);
            masm.call(here);
            masm.jump(here);
            masm.jump_table(a, &[start, end]);
        }
        (0..gap).for_each(|_| masm.nop());
        masm.bind(end);
        masm.ret();
    }

    fn try_restart<M: FloatAssembly>(features: M::Features) {
        let options = |shorten_jumps| Options {
            features,
            shorten_jumps,
            seed: 1,
        };
        let (mut masm, mut spent) = (M::new(options(false)), None);
        for (rounds, gap) in [(40, 9000), (1, 0), (3, 100), (0, 0), (60, 3)] {
            let options = options(rounds % 2 == 1);
            let mut fresh = M::new(options);
            emit(&mut fresh, rounds, gap);
            let expected = fresh.finish().unwrap();
            masm.restart(options, spent.filter(|_| rounds != 3));
            emit(&mut masm, rounds, gap);
            let code = masm.take_code().unwrap();
            assert_eq!(code.bytes(), expected.bytes());
            assert_eq!(code.relocations(), expected.relocations());
            assert_eq!(code.alignment(), expected.alignment());
            assert_eq!(code.instructions_end(), expected.instructions_end());
            spent = Some(code);
        }
    }

    #[test]
    fn nothing_is_left_after_a_restart() {
        try_restart::<x64::MacroAssembler>(X64Features::all());
        try_restart::<arm64::MacroAssembler>(Arm64Features::all());
    }

    /// Returns the least limit that is enough, and the size of the code.
    fn try_limits<M: FloatAssembly>(
        with_limit: impl Fn(usize) -> M,
        rounds: u32,
        gap: u32,
        step: usize,
    ) -> (usize, usize) {
        let finished = |limit| {
            let mut masm = with_limit(limit);
            emit(&mut masm, rounds, gap);
            let size = masm.size();
            (size, masm.finish())
        };
        let whole = finished(1 << 20).1.unwrap();
        let near = whole.bytes().len().saturating_sub(200);
        let limits = (0..near).step_by(step).chain(near..near + 2000);
        for limit in limits {
            if let (size, Ok(code)) = finished(limit) {
                assert!(size <= limit && code.bytes() == whole.bytes());
                assert!(finished(limit + 1).1.is_ok());
                return (limit, whole.bytes().len());
            }
        }
        panic!("no limit is enough");
    }

    fn options<Features>(features: Features, shorten_jumps: bool) -> Options<Features> {
        Options {
            features,
            shorten_jumps,
            seed: 0,
        }
    }

    #[test]
    fn x64_code_beyond_the_limit_is_refused() {
        for shorten_jumps in [false, true] {
            let with_limit = |limit| {
                let mut masm =
                    x64::MacroAssembler::new(options(X64Features::empty(), shorten_jumps));
                masm.assembler().buffer.limit = limit;
                masm
            };
            let (limit, size) = try_limits(with_limit, 12, 0, 1);
            assert!(limit == size || shorten_jumps && limit > size);
        }
    }

    #[test]
    fn arm64_code_beyond_the_limit_is_refused() {
        let with_limit = |limit| {
            let mut masm = arm64::MacroAssembler::new(options(Arm64Features::empty(), false));
            masm.assembler().buffer.limit = limit;
            masm
        };
        for (gap, step) in [(0, 1), (8192, 999)] {
            let (limit, size) = try_limits(with_limit, 12, gap, step);
            assert_eq!(limit, size);
        }
    }

    #[test]
    fn the_size_tells_that_code_was_lost() {
        let mut masm = arm64::MacroAssembler::new(options(Arm64Features::empty(), false));
        masm.assembler().buffer.limit = 1000;
        masm.reserve(usize::MAX);
        (0..300).for_each(|_| masm.nop());
        assert_eq!(masm.size(), usize::MAX);
        assert!(masm.finish().is_err());
    }
}
