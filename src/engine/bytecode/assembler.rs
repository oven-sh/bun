//! Collects instructions as words, to be encoded once all of them are known.

mod finish;

use core::ops::Range;

use bun_engine_syntax::EvalContext;

use crate::code::{CoverageBlock, HandlerKind, IntCases, IntSwitch, StringSwitch};
use crate::effects::for_each_operand_def;
use crate::instruction::{Flow, Opcode, Shape, field_type};
use crate::metadata::MetadataKind;
use crate::operand::*;
use crate::positions::Position;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Label(u32);

impl Label {
    /// As an operand for [`Assembler::replace`] and [`Assembler::set_operand`].
    #[cfg(test)]
    pub(crate) fn word(self) -> u32 {
        self.0
    }

    #[cfg(test)]
    pub(crate) fn from_word(word: u32) -> Label {
        Label(word)
    }
}

/// Where an instruction starts, or will start.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct Site(u32);

/// The first word of an instruction: its opcode and what the encoder needs of its description.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Header(u32);

impl Header {
    const METADATA: u32 = 8;
    /// A bit for each operand. With `SOURCE` it is a `Src`.
    const SIGNED: u32 = 14;
    /// Without `SIGNED` it is a `Target`.
    const SOURCE: u32 = 20;
    const THROWS: u32 = 1 << 26;
    const BRANCHES: u32 = 1 << 27;
    /// Is a `jump` or padding, or has a suspend point.
    const SPECIAL: u32 = 1 << 28;
    const OPERANDS: u32 = 29;

    const NO_METADATA: usize = MetadataKind::COUNT;
    /// Stands for a word that `replace` freed.
    const PADDING: Header = Header(Header::of(Opcode::Wide16Prefix).0 | Header::SPECIAL);
    const JUMP: Header = Header::of(Opcode::Goto);

    const fn of(opcode: Opcode) -> Header {
        let shapes = opcode.shapes();
        let metadata = match opcode.metadata() {
            Some(kind) => kind as u32,
            None => Self::NO_METADATA as u32,
        };
        let mut word =
            opcode as u32 | (shapes.len() as u32) << Self::OPERANDS | metadata << Self::METADATA;
        let mut index = 0;
        while index < shapes.len() {
            let (signed, source) = (
                1 << (Self::SIGNED + index as u32),
                1 << (Self::SOURCE + index as u32),
            );
            assert!(word & Self::BRANCHES == 0 || matches!(shapes[index], Shape::Target));
            word |= match shapes[index] {
                Shape::Src => signed | source,
                Shape::Target => source | Self::BRANCHES,
                shape if shape.is_signed() => signed,
                _ => 0,
            };
            index += 1;
        }
        if opcode.flow().can_throw() {
            word |= Self::THROWS;
        }
        if matches!(opcode, Opcode::Goto) || matches!(shapes, [.., Shape::SuspendPoint]) {
            word |= Self::SPECIAL;
        }
        Header(word)
    }

    #[inline(always)]
    const fn opcode(self) -> Opcode {
        Opcode::ALL[self.0 as u8 as usize]
    }

    #[inline(always)]
    const fn stops(self) -> bool {
        matches!(self.opcode().flow(), Flow::Jumps | Flow::Ends)
    }

    #[inline(always)]
    fn operands(self) -> usize {
        (self.0 >> Self::OPERANDS) as usize
    }

    #[inline(always)]
    fn metadata(self) -> usize {
        (self.0 >> Self::METADATA) as usize % METADATA_SLOTS
    }

    #[inline(always)]
    fn has(self, flag: u32) -> bool {
        self.0 & flag != 0
    }

    /// Those before the targets.
    #[inline(always)]
    fn plain_operands(self) -> usize {
        let targets = self.0 >> Self::SOURCE & !(self.0 >> Self::SIGNED) & 0x3f;
        (targets | 1 << self.operands()).trailing_zeros() as usize
    }

    /// The indices of the operands that are targets.
    #[inline(always)]
    fn targets(self) -> Range<usize> {
        self.plain_operands()..self.operands()
    }
}

static HEADERS: [Header; Opcode::COUNT] = {
    let mut headers = [Header::PADDING; Opcode::COUNT];
    let mut index = 0;
    while index < Opcode::COUNT {
        headers[index] = Header::of(Opcode::ALL[index]);
        index += 1;
    }
    headers
};

type Operands = [u32; Opcode::MAX_OPERANDS];

/// The words that may be touched from the start of an instruction.
const WINDOW: usize = 1 + Opcode::MAX_OPERANDS;
const METADATA_SLOTS: usize = 64;
const METADATA_SLOTS_USED: usize = (Header::NO_METADATA + 1).next_multiple_of(8);
const RETAINED_WORDS: usize = 1 << 16;
const NOWHERE: u32 = i32::MAX as u32;
const REFERENCED: u32 = 1 << 31;
const MAX_DENSE_RANGE: i64 = 1000;
const MAX_DENSE_RANGE_PER_CASE: i64 = 15;
const MASKS_COMPARED: usize = 8;

struct OpenTry {
    handler: Label,
    kind: HandlerKind,
    start: u32,
    /// Whether anything since `start` does, in an inner try or not.
    throws: bool,
}

struct TryRange {
    handler: Label,
    kind: HandlerKind,
    depth: u32,
    start: u32,
    end: u32,
}

#[must_use]
pub(crate) struct SuspendedTries {
    count: u32,
    at: u32,
}

pub(crate) struct Assembler {
    /// Longer than `len`, so that an instruction is stored without a check for each word.
    words: Vec<u32>,
    len: u32,
    last: u32,
    is_reachable: bool,
    is_too_large: bool,
    has_jumps: bool,
    records_positions: bool,
    /// Since the last instruction that can throw.
    tries_have_changed: bool,
    /// For the next instruction that can throw: a position, or other tries.
    has_news: bool,
    /// Past the boundary of a try if anything since can throw.
    noticed_throw: u32,
    discarded: Operands,
    metadata_counts: [u32; METADATA_SLOTS],
    /// Where each is bound, or `NOWHERE`, and `REFERENCED`.
    labels: Vec<u32>,
    pending_position: Option<Position>,
    positions: Vec<(u32, Position)>,
    tries: Vec<OpenTry>,
    suspended_tries: Vec<OpenTry>,
    try_ranges: Vec<TryRange>,
    /// With labels for targets.
    int_switches: Vec<IntSwitch>,
    /// With labels for targets, or `NOWHERE` if unreachable code added it.
    string_switches: Vec<StringSwitch>,
    spread_masks: Vec<Box<[u32]>>,
    mask: Vec<u32>,
    /// Each with a range of `kept_registers`.
    suspensions: Vec<(SuspendKind, Range<u32>)>,
    kept_registers: Vec<Register>,
    coverage_blocks: Vec<CoverageBlock>,
    scope_registers: Vec<(u32, Register)>,
    /// How far `last_writes` goes.
    tracked: u32,
    /// For each register, where the last instruction ends that writes it.
    last_writes: Vec<u32>,
    encoder: finish::Encoder,
}

impl Default for Assembler {
    fn default() -> Assembler {
        Assembler {
            words: Vec::new(),
            len: 0,
            last: NOWHERE,
            is_reachable: true,
            is_too_large: false,
            has_jumps: false,
            records_positions: true,
            tries_have_changed: false,
            has_news: false,
            noticed_throw: 0,
            discarded: Operands::default(),
            metadata_counts: [0; METADATA_SLOTS],
            labels: Vec::new(),
            pending_position: None,
            positions: Vec::new(),
            tries: Vec::new(),
            suspended_tries: Vec::new(),
            try_ranges: Vec::new(),
            int_switches: Vec::new(),
            string_switches: Vec::new(),
            spread_masks: Vec::new(),
            mask: Vec::new(),
            suspensions: Vec::new(),
            kept_registers: Vec::new(),
            coverage_blocks: Vec::new(),
            scope_registers: Vec::new(),
            tracked: 0,
            last_writes: Vec::new(),
            encoder: finish::Encoder::default(),
        }
    }
}

macro_rules! parameter_type {
    (Target) => { Label };
    (Src) => { impl Into<Operand> };
    ($shape:ident) => { field_type!($shape) };
}

macro_rules! operand_word {
    ($assembler:ident, Target, $operand:ident) => {
        $assembler.refer_to($operand)
    };
    ($assembler:ident, Src, $operand:ident) => {
        $operand.into().word()
    };
    ($assembler:ident, $shape:ident, $operand:ident) => {
        $operand.word()
    };
}

macro_rules! define_emitters {
    (
        $(#[$wide16_doc:meta])* Wide16Prefix wide16_prefix Pure {};
        $(#[$wide32_doc:meta])* Wide32Prefix wide32_prefix Pure {};
        $(
            $(#[$doc:meta])*
            $name:ident $mnemonic:ident $flow:ident { $($field:ident: $shape:ident),* } $(=> $metadata:ident)?;
        )*
    ) => {
        impl Assembler {$(
            $(#[$doc])*
            #[inline]
            pub(crate) fn $mnemonic(&mut self, $($field: parameter_type!($shape)),*) {
                const COUNT: usize = Opcode::$name.shapes().len();
                let words: [u32; COUNT] = [$(operand_word!(self, $shape, $field)),*];
                const HEADER: Header = Header::of(Opcode::$name);
                let operands = if HEADER.has(Header::THROWS) {
                    self.emit_throwing(HEADER)
                } else {
                    self.emit(HEADER)
                };
                operands[..COUNT].copy_from_slice(&words);
                if const { HEADER.stops() } {
                    self.is_reachable = false;
                }
                if HEADER == Header::JUMP {
                    self.has_jumps = true;
                }
            }
        )*}
    };
}

crate::instruction_table!(define_emitters);

impl Assembler {
    pub(crate) fn reset(&mut self) {
        if self.words.len() > RETAINED_WORDS {
            *self = Assembler::default();
            return;
        }
        self.len = 0;
        self.last = NOWHERE;
        self.is_reachable = true;
        self.is_too_large = false;
        self.has_jumps = false;
        self.records_positions = true;
        self.tries_have_changed = false;
        self.has_news = false;
        self.noticed_throw = 0;
        self.metadata_counts[..METADATA_SLOTS_USED].fill(0);
        self.labels.clear();
        self.pending_position = None;
        self.positions.clear();
        self.tries.clear();
        self.suspended_tries.clear();
        self.try_ranges.clear();
        self.int_switches.clear();
        self.string_switches.clear();
        self.spread_masks.clear();
        self.suspensions.clear();
        self.kept_registers.clear();
        self.coverage_blocks.clear();
        self.scope_registers.clear();
        self.last_writes.clear();
    }

    /// Returns where the operands go.
    #[inline(never)]
    fn emit(&mut self, header: Header) -> &mut Operands {
        self.append(header)
    }

    #[inline(never)]
    fn emit_throwing(&mut self, header: Header) -> &mut Operands {
        if self.has_news {
            if self.tries_have_changed
                || !self.is_reachable
                || self.positions.len() == self.positions.capacity()
            {
                return self.notice_and_emit(header);
            }
            self.record_position(self.len);
        }
        self.append(header)
    }

    #[cold]
    fn notice_and_emit(&mut self, header: Header) -> &mut Operands {
        if self.is_reachable {
            self.notice_throw(self.len);
        }
        self.emit(header)
    }

    #[inline(always)]
    fn append(&mut self, header: Header) -> &mut Operands {
        let at = self.len;
        if !self.is_reachable || at as usize + WINDOW > self.words.len() {
            return self.grow_or_discard(header);
        }
        self.metadata_counts[header.metadata()] += 1;
        self.last = at;
        self.len = at + 1 + header.operands() as u32;
        let window = &mut self.words[at as usize..at as usize + WINDOW];
        window[0] = header.0;
        window[1..].first_chunk_mut().expect("is as long")
    }

    #[cold]
    fn grow_or_discard(&mut self, header: Header) -> &mut Operands {
        if self.is_reachable && self.grow() {
            return self.emit(header);
        }
        &mut self.discarded
    }

    /// If it cannot, no code is reachable from here on.
    #[cold]
    fn grow(&mut self) -> bool {
        let more = self.words.len().max(256);
        let len = self.words.len() + more;
        if len >= NOWHERE as usize || self.words.try_reserve_exact(more).is_err() {
            self.is_too_large = true;
            self.is_reachable = false;
            return false;
        }
        self.words.resize(len, 0);
        true
    }

    fn notice_throw(&mut self, at: u32) {
        self.positions.reserve(1);
        self.record_position(at);
        self.tries_have_changed = false;
        self.noticed_throw = at + 1;
        if let Some(open) = self.tries.last_mut() {
            open.throws = true;
            self.labels[open.handler.0 as usize] |= REFERENCED;
        }
    }

    #[inline(always)]
    fn record_position(&mut self, at: u32) {
        self.has_news = false;
        if let Some(position) = self.pending_position
            && self.positions.last().is_none_or(|last| last.1 != position)
        {
            self.positions.push((at, position));
        }
    }

    // Labels

    #[inline]
    pub(crate) fn label(&mut self) -> Label {
        self.labels.push(NOWHERE);
        Label(self.labels.len() as u32 - 1)
    }

    #[inline]
    fn refer_to(&mut self, label: Label) -> u32 {
        self.labels[label.0 as usize] |= u32::from(self.is_reachable) * REFERENCED;
        label.0
    }

    pub(crate) fn bind(&mut self, label: Label) {
        self.is_reachable |= self.is_referenced(label) && !self.is_too_large;
        self.bind_loop_head(label);
    }

    pub(crate) fn bind_loop_head(&mut self, label: Label) {
        self.last = NOWHERE;
        let state = &mut self.labels[label.0 as usize];
        debug_assert!(*state & !REFERENCED == NOWHERE, "bound twice");
        if self.is_reachable {
            *state = *state & REFERENCED | self.len;
        }
    }

    #[inline]
    pub(crate) fn is_reachable(&self) -> bool {
        self.is_reachable
    }

    #[inline]
    pub(crate) fn is_referenced(&self, label: Label) -> bool {
        self.labels[label.0 as usize] & REFERENCED != 0
    }

    /// Whether it is evident that what is still to come cannot be reached without passing here.
    pub(crate) fn is_on_every_way(&self) -> bool {
        const MOST_LOOKED_AT: usize = 64;
        self.is_reachable
            && self.tries.is_empty()
            && self.suspended_tries.is_empty()
            && self.labels.len() <= MOST_LOOKED_AT
            && !self.labels.contains(&(NOWHERE | REFERENCED))
    }

    // Positions

    #[inline]
    pub(crate) fn position(&mut self, divot: u32, start: u32, end: u32) {
        if self.records_positions {
            self.pending_position = Some(Position { divot, start, end });
            self.has_news = true;
        }
    }

    pub(crate) fn set_records_positions(&mut self, records_positions: bool) {
        self.records_positions = records_positions;
    }

    // Instructions already emitted

    #[inline]
    pub(crate) fn here(&self) -> Site {
        Site(self.len)
    }

    #[inline]
    fn header(&self, site: u32) -> Header {
        Header(self.words[site as usize])
    }

    /// None after a label or the boundary of a try.
    #[inline]
    pub(crate) fn last(&self) -> Option<(Site, Opcode)> {
        (self.last != NOWHERE && self.is_reachable)
            .then(|| (Site(self.last), self.header(self.last).opcode()))
    }

    /// All are, until there is no more room.
    #[inline]
    fn is_emitted(&self, site: Site) -> bool {
        debug_assert!(site.0 < self.len || self.is_too_large);
        site.0 < self.len
    }

    pub(crate) fn opcode(&self, site: Site) -> Opcode {
        if !self.is_emitted(site) {
            return Opcode::LoopHint;
        }
        self.header(site.0).opcode()
    }

    #[inline]
    pub(crate) fn operand(&self, site: Site, index: usize) -> u32 {
        if !self.is_emitted(site) {
            return 0;
        }
        debug_assert!(index < self.header(site.0).operands());
        self.words[site.0 as usize + 1 + index]
    }

    #[inline]
    pub(crate) fn set_operand(&mut self, site: Site, index: usize, word: u32) {
        if !self.is_emitted(site) {
            return;
        }
        debug_assert!(index < self.header(site.0).operands());
        self.words[site.0 as usize + 1 + index] = word;
        if self.header(site.0).targets().contains(&index) {
            self.labels[word as usize] |= REFERENCED;
        }
    }

    /// Only the last instruction may come to throw, or change whether control goes on to the next.
    pub(crate) fn replace(&mut self, site: Site, opcode: Opcode, words: &[u32]) {
        if !self.is_emitted(site) {
            return;
        }
        let (old, new) = (self.header(site.0), HEADERS[opcode as usize]);
        let start = site.0 as usize;
        let mut end = start + 1 + old.operands();
        while end < self.len as usize && self.words[end] == Header::PADDING.0 {
            end += 1;
        }
        assert!(words.len() == new.operands());
        let (operands, padding) = self.words[start + 1..end].split_at_mut(words.len());
        operands.copy_from_slice(words);
        padding.fill(Header::PADDING.0);
        // A position or a try may be there for it, so it is not left out even as a `jump`.
        self.words[start] = new.0 | old.0 & Header::THROWS;
        self.has_jumps |= new == Header::JUMP;
        self.metadata_counts[old.metadata()] -= 1;
        self.metadata_counts[new.metadata()] += 1;
        for index in new.targets() {
            self.labels[words[index] as usize] |= REFERENCED;
        }
        if site.0 != self.last {
            debug_assert!(old.has(Header::THROWS) || !new.has(Header::THROWS));
            debug_assert!(old.stops() == new.stops());
            return;
        }
        if new.has(Header::THROWS) && !old.has(Header::THROWS) {
            self.notice_throw(site.0);
        }
        self.is_reachable = !new.stops() && !self.is_too_large;
    }

    /// One that has no metadata, and neither throws nor jumps.
    pub(crate) fn remove(&mut self, site: Site) {
        let header = self.header(site.0);
        debug_assert!(header.opcode().flow() == Flow::Pure && site.0 != self.last);
        self.words[site.0 as usize..][..=header.operands()].fill(Header::PADDING.0);
    }

    /// From here on.
    pub(crate) fn track_writes(&mut self) {
        self.tracked = self.len;
    }

    /// `since` is not before where the tracking started.
    pub(crate) fn has_written(&mut self, register: Register, since: Site) -> bool {
        // Locals and arguments in turn.
        let index =
            |register: Register| (register.offset() << 1 ^ register.offset() >> 31) as usize;
        while self.tracked < self.len {
            let at = self.tracked as usize;
            let header = Header(self.words[at]);
            let operands = &self.words[at + 1..][..header.operands()];
            self.tracked += 1 + operands.len() as u32;
            for_each_operand_def(header.opcode(), operands, |run, _| {
                for index in run.registers().map(index) {
                    if index >= self.last_writes.len() {
                        self.last_writes.resize(2 * index + 2, 0);
                    }
                    self.last_writes[index] = self.tracked;
                }
            });
        }
        (self.last_writes.get(index(register))).is_some_and(|&end| end > since.0)
    }

    // Tries

    pub(crate) fn push_try(&mut self, handler: Label, kind: HandlerKind) {
        self.tries.push(OpenTry {
            handler,
            kind,
            start: self.len,
            throws: false,
        });
        self.note_try_boundary();
    }

    fn note_try_boundary(&mut self) {
        self.tries_have_changed = true;
        self.has_news = true;
        self.last = NOWHERE;
    }

    pub(crate) fn pop_try(&mut self) {
        self.close_try();
    }

    fn close_try(&mut self) -> OpenTry {
        let open = self.tries.pop().expect("a try is open");
        self.note_try_boundary();
        if open.throws {
            self.try_ranges.push(TryRange {
                handler: open.handler,
                kind: open.kind,
                depth: self.tries.len() as u32,
                start: open.start,
                end: self.len,
            });
            if let Some(outer) = self.tries.last_mut() {
                outer.throws = true;
            }
        }
        open
    }

    pub(crate) fn try_depth(&self) -> u32 {
        self.tries.len() as u32
    }

    /// Resumed in the opposite order.
    pub(crate) fn suspend_tries(&mut self, down_to_depth: u32) -> SuspendedTries {
        let count = self.try_depth() - down_to_depth;
        for _ in 0..count {
            let open = self.close_try();
            self.suspended_tries.push(open);
        }
        SuspendedTries {
            count,
            at: self.len,
        }
    }

    #[expect(clippy::needless_pass_by_value, reason = "once only")]
    pub(crate) fn resume_tries(&mut self, suspended: SuspendedTries) {
        let SuspendedTries { count, at } = suspended;
        // What cannot throw may as well be inside.
        let start = if self.noticed_throw > at {
            self.len
        } else {
            at
        };
        let first = self.suspended_tries.len() - count as usize;
        let resumed = self.suspended_tries.drain(first..).rev();
        self.tries.extend(resumed.map(|open| OpenTry {
            start,
            throws: false,
            ..open
        }));
        self.note_try_boundary();
    }

    // Tables

    /// Of two cases with one key the first counts.
    pub(crate) fn add_int_switch(
        &mut self,
        default: Label,
        cases: &[(i32, Label)],
    ) -> IntSwitchIndex {
        if !self.is_reachable {
            return IntSwitchIndex(0);
        }
        let mut sorted: Vec<(i32, u32)> =
            cases.iter().map(|&(key, label)| (key, label.0)).collect();
        sorted.sort_by_key(|&(key, _)| key);
        sorted.dedup_by_key(|&mut (key, _)| key);
        for &(_, label) in &sorted {
            self.refer_to(Label(label));
        }
        let default = self.refer_to(default);
        let dense = match (sorted.first(), sorted.last()) {
            (Some(&(first, _)), Some(&(last, _))) => {
                let range = i64::from(last) - i64::from(first);
                let is_dense = range <= MAX_DENSE_RANGE
                    && range / (sorted.len() as i64) < MAX_DENSE_RANGE_PER_CASE;
                is_dense.then_some((first, range as usize + 1))
            }
            _ => None,
        };
        let cases = match dense {
            Some((first, len)) => {
                let mut targets = vec![default; len].into_boxed_slice();
                for (key, label) in sorted {
                    targets[(key - first) as usize] = label;
                }
                IntCases::Dense { first, targets }
            }
            None => IntCases::Sparse(sorted.into()),
        };
        self.int_switches.push(IntSwitch { default, cases });
        IntSwitchIndex(self.int_switches.len() as u32 - 1)
    }

    /// Counts in unreachable code too, so that the index agrees with that of the keys.
    pub(crate) fn add_string_switch(
        &mut self,
        default: Label,
        targets: &[Label],
    ) -> StringSwitchIndex {
        let mut word = |label| {
            if self.is_reachable {
                self.refer_to(label)
            } else {
                NOWHERE
            }
        };
        let switch = StringSwitch {
            default: word(default),
            targets: targets.iter().copied().map(word).collect(),
        };
        self.string_switches.push(switch);
        StringSwitchIndex(self.string_switches.len() as u32 - 1)
    }

    pub(crate) fn add_spread_mask(&mut self, bits: impl Iterator<Item = bool>) -> SpreadMaskIndex {
        self.mask.clear();
        for (index, _) in bits.enumerate().filter(|&(_, bit)| bit) {
            self.mask.resize(index / 32 + 1, 0);
            self.mask[index / 32] |= 1 << (index % 32);
        }
        self.share_mask()
    }

    fn share_mask(&mut self) -> SpreadMaskIndex {
        if !self.is_reachable {
            return SpreadMaskIndex(0);
        }
        let first = self.spread_masks.len().saturating_sub(MASKS_COMPARED);
        let same = self.spread_masks[first..]
            .iter()
            .position(|mask| **mask == *self.mask);
        if let Some(position) = same {
            return SpreadMaskIndex((first + position) as u32);
        }
        self.spread_masks.push(self.mask.as_slice().into());
        SpreadMaskIndex(self.spread_masks.len() as u32 - 1)
    }

    /// The index is only for the operands: `finish` numbers the points that are left again.
    pub(crate) fn add_suspend_point(&mut self, kind: SuspendKind) -> SuspendPointIndex {
        let kept = self.kept_registers.len() as u32;
        self.suspensions.push((kind, kept..kept));
        SuspendPointIndex(self.suspensions.len() as u32 - 1)
    }

    /// The point that was added last saves them, whether they are read again or not. They are written on all ways there.
    pub(crate) fn keep_while_suspended(&mut self, registers: impl Iterator<Item = Register>) {
        const MAX_KEPT: usize = 1 << 20;
        if let Some((_, kept)) = self.suspensions.last_mut() {
            let room = MAX_KEPT - self.kept_registers.len();
            self.kept_registers.extend(registers.take(room));
            kept.end = self.kept_registers.len() as u32;
        }
    }

    /// From the next instruction on.
    pub(crate) fn set_scope_register(&mut self, register: Register) {
        self.scope_registers.push((self.len, register));
    }

    pub(crate) fn add_coverage_block(&mut self, block: CoverageBlock) -> CoverageBlockIndex {
        self.coverage_blocks.push(block);
        CoverageBlockIndex(self.coverage_blocks.len() as u32 - 1)
    }
}
