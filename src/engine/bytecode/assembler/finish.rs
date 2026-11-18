//! From words and labels to bytes and offsets.

use super::{Assembler, Header, METADATA_SLOTS, NOWHERE, Operands, REFERENCED, TryRange, WINDOW};
use crate::code::{
    Body, CodeFlags, CodeKind, Handler, IntCases, SavedRegister, Storage, StringSwitch,
    SuspendPoint, Tables, TooLarge,
};
use crate::instruction::Opcode;
use crate::liveness::SavedRegisters;
use crate::metadata::{MetadataKind, MetadataLayout};
use crate::operand::{Narrow, Wide16, Wide32, Width};
use crate::positions::Positions;

const MAX_INSTRUCTION_BYTES: usize = 32;
const MAX_LAYOUT_BYTES: usize = MetadataLayout::KINDS_BYTES + 4 * MetadataKind::COUNT;
const _: () = assert!(MAX_LAYOUT_BYTES <= u8::MAX as usize);
const MAX_ENTRY_WORDS: u8 = 8;
const MAX_TARGETS: usize = 2;
const MAX_JUMPS_THREADED: usize = 4;
const MAX_SHRINKING_PASSES: usize = 3;

type InstructionBytes = [u8; MAX_INSTRUCTION_BYTES];

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Size {
    Narrow,
    Wide16,
    Wide32,
}

impl Size {
    fn of_distance(distance: i64) -> Size {
        if i8::try_from(distance).is_ok() {
            Size::Narrow
        } else if i16::try_from(distance).is_ok() {
            Size::Wide16
        } else {
            Size::Wide32
        }
    }

    fn bytes(self, header: Header) -> u32 {
        let opcode = header.opcode();
        let bytes = match self {
            Size::Narrow => opcode.size::<Narrow>(),
            Size::Wide16 => opcode.size::<Wide16>(),
            Size::Wide32 => opcode.size::<Wide32>(),
        };
        bytes as u32
    }

    /// For operands that fit. Returns the size.
    #[inline(never)]
    fn put(
        self,
        header: Header,
        operands: &Operands,
        metadata: u32,
        bytes: &mut InstructionBytes,
    ) -> usize {
        match self {
            Size::Narrow => put::<Narrow>(header, operands, metadata, bytes),
            Size::Wide16 => put::<Wide16>(header, operands, metadata, bytes),
            Size::Wide32 => put::<Wide32>(header, operands, metadata, bytes),
        }
        .expect("they fit")
    }
}

/// Returns the size if the operands fit. Leaves room for the targets.
#[inline(always)]
fn put<W: Width>(
    header: Header,
    operands: &Operands,
    metadata: u32,
    bytes: &mut InstructionBytes,
) -> Option<usize> {
    let half = 1u32 << (8 * W::OPERAND_BYTES - 1);
    let constants_move = (W::FIRST_CONSTANT - Wide32::FIRST_CONSTANT) as u32;
    bytes[0] = if W::OPERAND_BYTES == 2 {
        Opcode::Wide16Prefix as u8
    } else {
        Opcode::Wide32Prefix as u8
    };
    bytes[W::PREFIX_BYTES] = header.0 as u8;
    let (first, mut all) = (W::PREFIX_BYTES + 1, 0);
    for (index, &word) in operands[..header.plain_operands()].iter().enumerate() {
        let is_signed = header.has(1 << (Header::SIGNED + index as u32));
        let is_source = header.has(1 << (Header::SOURCE + index as u32));
        // A register that would be taken for a constant moves out of range.
        let stored = match is_source & (word as i32 >= W::FIRST_CONSTANT) {
            true => word.wrapping_add(constants_move),
            false => word,
        };
        all |= stored.wrapping_add(if is_signed { half } else { 0 });
        bytes[first + index * W::OPERAND_BYTES..][..4].copy_from_slice(&stored.to_le_bytes());
    }
    let end = first + header.operands() * W::OPERAND_BYTES;
    bytes[end..end + 4].copy_from_slice(&metadata.to_le_bytes());
    let has_metadata = header.metadata() != Header::NO_METADATA;
    let fits = all / 2 < half && u64::from(metadata) >> (8 * W::METADATA_BYTES) == 0;
    fits.then_some(end + usize::from(has_metadata) * W::METADATA_BYTES)
}

fn put_distance(size: Size, index: usize, distance: u32, instruction: &mut [u8]) {
    fn put<W: Width>(index: usize, distance: u32, instruction: &mut [u8]) {
        let at = W::PREFIX_BYTES + 1 + index * W::OPERAND_BYTES;
        instruction[at..at + W::OPERAND_BYTES]
            .copy_from_slice(&distance.to_le_bytes()[..W::OPERAND_BYTES]);
    }
    match size {
        Size::Narrow => put::<Narrow>(index, distance, instruction),
        Size::Wide16 => put::<Wide16>(index, distance, instruction),
        Size::Wide32 => put::<Wide32>(index, distance, instruction),
    }
}

/// An instruction with a target.
struct Branch {
    header: Header,
    site: u32,
    size: Size,
}

/// A branch that may not reach its targets at the size that its other operands need.
struct FarBranch {
    branch: u32,
    /// In the draft.
    offset: u32,
    size: Size,
    growth: u32,
    /// In the draft, each with the number of far branches before it.
    targets: [(u32, u32); MAX_TARGETS],
}

/// The draft has every branch at the size that its other operands need.
#[derive(Default)]
pub(super) struct Encoder {
    bytes: Vec<u8>,
    /// Where the instructions start.
    layout_size: usize,
    branches: Vec<Branch>,
    far_branches: Vec<FarBranch>,
    /// For each far branch and for the end: the offset in the draft, and how far what is there moves.
    shifts: Vec<(u32, u32)>,
    /// The sites of the instructions that suspend and resume, and the index that the point was added with.
    suspend_points: Vec<(u32, u32, u32)>,
    saved_registers: SavedRegisters,
}

impl Encoder {
    fn reserve(&mut self, size: usize) -> Result<(), TooLarge> {
        if let Some(more) = size.checked_sub(self.bytes.len()) {
            self.bytes.try_reserve(more).map_err(|_| TooLarge)?;
            self.bytes.resize(self.bytes.capacity(), 0);
        }
        Ok(())
    }

    #[inline]
    fn moved(&self, draft_offset: u32) -> u32 {
        if self.shifts.is_empty() {
            return draft_offset;
        }
        let before = self
            .shifts
            .partition_point(|&(offset, _)| offset < draft_offset);
        draft_offset + self.shifts[before].1
    }

    fn sum_growth(&mut self) -> Result<u32, TooLarge> {
        self.shifts.clear();
        let mut shift = 0u32;
        for far in &self.far_branches {
            self.shifts.push((far.offset, shift));
            shift = shift.checked_add(far.growth).ok_or(TooLarge)?;
        }
        self.shifts.push((u32::MAX, shift));
        Ok(shift)
    }

    /// Distances only get shorter, so any pass can be the last.
    fn shrink(&mut self) -> bool {
        let mut has_changed = false;
        for (far, &(_, shift)) in self.far_branches.iter_mut().zip(&self.shifts) {
            let branch = &self.branches[far.branch as usize];
            let least = branch.size.bytes(branch.header);
            let from = i64::from(far.offset) + i64::from(shift);
            for size in [Size::Narrow, Size::Wide16] {
                if size < branch.size || size >= far.size {
                    continue;
                }
                let growth = size.bytes(branch.header) - least;
                let reaches = far.targets.iter().all(|&(target, before)| {
                    let to = i64::from(target) + i64::from(self.shifts[before as usize].1);
                    let saved = if target > far.offset {
                        far.growth - growth
                    } else {
                        0
                    };
                    Size::of_distance(to - from - i64::from(saved)) <= size
                });
                if reaches {
                    (far.size, far.growth) = (size, growth);
                    has_changed = true;
                    break;
                }
            }
        }
        has_changed
    }
}

/// How far the draft has got.
#[derive(Clone, Copy)]
struct Cursor {
    site: u32,
    offset: u32,
    previous: Header,
}

static ENTRY_WORDS: [u8; METADATA_SLOTS] = {
    let mut words = [0; METADATA_SLOTS];
    let mut index = 0;
    while index < MetadataKind::COUNT {
        words[index] = MetadataKind::ALL[index].words() as u8;
        assert!(words[index] <= MAX_ENTRY_WORDS);
        index += 1;
    }
    words
};

/// Where the next entry of each kind goes.
type NextEntries = [u32; METADATA_SLOTS];

#[inline(always)]
fn take_entry(next: &mut NextEntries, header: Header) -> u32 {
    let next = &mut next[header.metadata()];
    let entry = *next;
    *next += u32::from(ENTRY_WORDS[header.metadata()]);
    entry
}

#[inline(always)]
fn chunk_at<T, const N: usize>(slice: &mut [T], at: u32) -> Option<&mut [T; N]> {
    slice
        .get_mut(at as usize..at as usize + N)?
        .first_chunk_mut()
}

/// A bit for each that is not zero.
fn kinds_in_use(counts: &[u32; METADATA_SLOTS]) -> u64 {
    let bits = |counts: &[u32]| {
        let counts = counts.iter().enumerate();
        counts.fold(0, |bits, (bit, &count)| bits | u32::from(count != 0) << bit)
    };
    let (low, high) = counts[..MetadataKind::COUNT.next_multiple_of(4)].split_at(32);
    (u64::from(bits(high)) << 32 | u64::from(bits(low))) & !(u64::MAX << MetadataKind::COUNT)
}

impl Assembler {
    /// Nothing but `reset` follows.
    pub(crate) fn finish(
        &mut self,
        kind: CodeKind,
        flags: CodeFlags,
        locals: u32,
        parameters: u32,
    ) -> Result<Body, TooLarge> {
        debug_assert!(self.tries.is_empty() && self.suspended_tries.is_empty());
        if self.is_too_large
            || locals.max(parameters) > Body::MAX_FRAME_WORDS
            || (self.len as usize + WINDOW > self.words.len() && !self.grow())
        {
            return Err(TooLarge);
        }
        self.lay_out_metadata()?;
        let jumps_are_bypassed = !self.has_jumps || self.thread_jumps();
        let mut size = self.draft(jumps_are_bypassed)?;
        if !self.put_near_distances() {
            size = self.widen_far_branches(size)?;
            self.put_final_distances();
        }
        let end = self.put_positions(size)?;
        let mut bytes = Vec::new();
        bytes.try_reserve_exact(end).map_err(|_| TooLarge)?;
        bytes.extend_from_slice(&self.encoder.bytes[..end]);

        let mut body = Body {
            storage: Storage::Owned(bytes.into()),
            tables: None,
            start: self.encoder.layout_size as u32,
            instructions_size: size,
            positions_at: 0,
            locals,
            parameters,
            kind,
            flags,
            layout_size: self.encoder.layout_size as u8,
        };
        if self.may_have_tables() {
            self.add_tables(&mut body)?;
        }
        Ok(body)
    }

    /// Replaces each count with the word where the entries start.
    fn lay_out_metadata(&mut self) -> Result<(), TooLarge> {
        let kinds = kinds_in_use(&self.metadata_counts);
        self.metadata_counts[Header::NO_METADATA] = 0;
        self.encoder.reserve(MAX_LAYOUT_BYTES)?;
        let bytes = &mut self.encoder.bytes[..MAX_LAYOUT_BYTES];
        let is_small = self.len <= u32::from(u16::MAX / u16::from(MAX_ENTRY_WORDS));
        let words_of = |kind: usize, count| u64::from(count) * u64::from(ENTRY_WORDS[kind]);
        let step = if is_small {
            2
        } else {
            let counts = self.metadata_counts.iter().enumerate();
            match counts.map(|(kind, &count)| words_of(kind, count)).sum() {
                0..=0xffff => 2,
                0x1_0000..=0xffff_ffff => 4,
                _ => return Err(TooLarge),
            }
        };
        bytes[..size_of_val(&kinds)].copy_from_slice(&kinds.to_le_bytes());
        let (mut rest, mut words) = (kinds, 0);
        let mut at = MetadataLayout::KINDS_BYTES * usize::from(kinds != 0);
        while rest != 0 {
            let kind = rest.trailing_zeros() as usize % METADATA_SLOTS;
            let count = core::mem::replace(&mut self.metadata_counts[kind], words);
            words += words_of(kind, count) as u32;
            bytes[at..at + 4].copy_from_slice(&words.to_le_bytes());
            at += step;
            rest &= rest - 1;
        }
        self.encoder.layout_size = at;
        Ok(())
    }

    /// Returns where they end.
    #[inline(never)]
    fn put_positions(&mut self, size: u32) -> Result<usize, TooLarge> {
        let start = self.encoder.layout_size + size as usize;
        self.encoder
            .reserve(start + Positions::max_size(self.positions.len()))?;
        for (site, _) in &mut self.positions {
            *site = self.words[*site as usize];
        }
        if let Some((mut next, mut shifts)) = self.encoder.shifts.split_first() {
            for (offset, _) in &mut self.positions {
                while next.0 < *offset {
                    (next, shifts) = shifts.split_first().expect("the last is past the end");
                }
                *offset += next.1;
            }
        }
        Ok(start + Positions::encode(&self.positions, &mut self.encoder.bytes[start..]))
    }

    /// Moves the labels of each `jump` to its target. If that works for all, a `jump` is only reached from above.
    fn thread_jumps(&mut self) -> bool {
        self.words[self.len as usize] = Header::PADDING.0;
        let mut jumps_are_bypassed = true;
        for index in 0..self.labels.len() {
            let state = self.labels[index];
            debug_assert!(state != NOWHERE | REFERENCED, "not bound");
            let mut site = state & !REFERENCED;
            if state & REFERENCED != 0 {
                let mut jumps = 0;
                while self.header(site) == Header::JUMP {
                    if jumps == MAX_JUMPS_THREADED {
                        jumps_are_bypassed = false;
                        break;
                    }
                    site = self.labels[self.words[site as usize + 1] as usize] & !REFERENCED;
                    jumps += 1;
                }
            }
            self.labels[index] = state & REFERENCED | site;
        }
        jumps_are_bypassed
    }

    #[inline]
    fn site_of(&self, label: u32) -> u32 {
        self.labels[label as usize] & !REFERENCED
    }

    /// Replaces each header with the offset of the instruction in the draft. Returns the size.
    #[inline(never)]
    fn draft(&mut self, jumps_are_bypassed: bool) -> Result<u32, TooLarge> {
        self.encoder.branches.clear();
        self.encoder.shifts.clear();
        self.encoder.suspend_points.clear();
        let mut at = Cursor {
            site: 0,
            offset: 0,
            previous: Header::PADDING,
        };
        loop {
            self.draft_usual(&mut at);
            if at.offset > Body::MAX_SIZE {
                return Err(TooLarge);
            }
            if at.site >= self.len {
                self.words[at.site as usize] = at.offset;
                return Ok(at.offset);
            }
            let end = self.encoder.layout_size + at.offset as usize + MAX_INSTRUCTION_BYTES;
            if end > self.encoder.bytes.len() {
                self.encoder
                    .reserve(end + 2 * (self.len - at.site) as usize)?;
            }
            self.draft_any(&mut at, jumps_are_bypassed);
        }
    }

    /// Up to the first instruction that takes more thought. Calls nothing, which keeps its state in registers.
    #[inline(never)]
    fn draft_usual(&mut self, at: &mut Cursor) {
        let words = &mut self.words[..self.len as usize + WINDOW - 1];
        let (next_entries, encoder) = (&mut self.metadata_counts, &mut self.encoder);
        let room = (encoder.bytes.len()).min(Body::MAX_SIZE as usize + MAX_LAYOUT_BYTES);
        let code = &mut encoder.bytes[encoder.layout_size..room];
        let Cursor {
            mut site,
            mut offset,
            mut previous,
        } = *at;
        while let Some(window) = chunk_at::<_, WINDOW>(words, site)
            && let Some(bytes) = chunk_at::<_, MAX_INSTRUCTION_BYTES>(code, offset)
        {
            let header = Header(window[0]);
            if header.has(Header::SPECIAL) {
                break;
            }
            let operands = window[1..].first_chunk().expect("is as long");
            let metadata = next_entries[header.metadata()];
            let (size, end) = if let Some(end) = put::<Narrow>(header, operands, metadata, bytes) {
                (Size::Narrow, end)
            } else if let Some(end) = put::<Wide16>(header, operands, metadata, bytes) {
                (Size::Wide16, end)
            } else {
                break;
            };
            if header.has(Header::BRANCHES) {
                if encoder.branches.len() == encoder.branches.capacity() {
                    break;
                }
                encoder.branches.push(Branch { header, site, size });
            }
            window[0] = offset;
            take_entry(next_entries, header);
            offset += end as u32;
            site += 1 + header.operands() as u32;
            previous = header;
        }
        *at = Cursor {
            site,
            offset,
            previous,
        };
    }

    #[inline(always)]
    fn draft_any(&mut self, at: &mut Cursor, jumps_are_bypassed: bool) {
        let Cursor { site, offset, .. } = *at;
        let header = self.header(site);
        self.words[site as usize] = offset;
        at.site += 1 + header.operands() as u32;
        if header == Header::PADDING {
            return;
        }
        if header == Header::JUMP {
            if at.previous.stops() && jumps_are_bypassed {
                return;
            }
            if self.jumps_over_nothing(site, jumps_are_bypassed) {
                at.site = self.site_of(self.words[site as usize + 1]);
                self.words[site as usize..at.site as usize].fill(offset);
                return;
            }
        }
        let has_target = header.has(Header::BRANCHES);
        if !has_target && header.has(Header::SPECIAL) {
            self.number_suspend_point(header, site);
        }
        let operands = self.words[site as usize + 1..]
            .first_chunk()
            .expect("grown");
        let bytes = self.encoder.bytes[self.encoder.layout_size + offset as usize..]
            .first_chunk_mut()
            .expect("reserved");
        let metadata = take_entry(&mut self.metadata_counts, header);
        let (size, end) = if let Some(end) = put::<Narrow>(header, operands, metadata, bytes) {
            (Size::Narrow, end)
        } else if let Some(end) = put::<Wide16>(header, operands, metadata, bytes) {
            (Size::Wide16, end)
        } else {
            let end = Size::Wide32.put(header, operands, metadata, bytes);
            (Size::Wide32, end)
        };
        at.offset += end as u32;
        if has_target {
            self.encoder.branches.push(Branch { header, site, size });
        }
        at.previous = header;
    }

    fn jumps_over_nothing(&self, site: u32, jumps_are_bypassed: bool) -> bool {
        let target = self.site_of(self.words[site as usize + 1]);
        let mut next = site + 2;
        while next < target {
            next += match self.header(next) {
                Header::PADDING => 1,
                Header::JUMP if jumps_are_bypassed => 2,
                _ => return false,
            };
        }
        next == target
    }

    fn number_suspend_point(&mut self, header: Header, site: u32) {
        let points = &mut self.encoder.suspend_points;
        let operand = &mut self.words[site as usize + header.operands()];
        if header.opcode() == Opcode::Resume {
            let (_, resume, point) = points.last_mut().expect("follows what suspends");
            debug_assert!(*point == *operand);
            *resume = site;
        } else {
            points.push((site, NOWHERE, *operand));
        }
        *operand = points.len() as u32 - 1;
    }

    #[inline]
    fn offset_of(&self, site: u32) -> u32 {
        self.encoder.moved(self.words[site as usize])
    }

    #[inline]
    fn target_of(&self, label: u32) -> u32 {
        self.offset_of(self.site_of(label))
    }

    /// In the draft. Returns whether all fit.
    fn put_near_distances(&mut self) -> bool {
        let (words, labels) = (self.words.as_slice(), self.labels.as_slice());
        let code = &mut self.encoder.bytes[self.encoder.layout_size..];
        for &Branch { header, site, size } in &self.encoder.branches {
            let from = words[site as usize];
            for index in header.targets() {
                let label = words[site as usize + 1 + index];
                let to = words[(labels[label as usize] & !REFERENCED) as usize];
                let distance = to.wrapping_sub(from);
                if size == Size::Narrow && distance.wrapping_add(0x80) <= 0xff {
                    code[from as usize + 1 + index] = distance as u8;
                } else if Size::of_distance(i64::from(distance as i32)) <= size {
                    put_distance(size, index, distance, &mut code[from as usize..]);
                } else {
                    return false;
                }
            }
        }
        true
    }

    fn put_final_distances(&mut self) {
        for branch in 0..self.encoder.branches.len() {
            let Branch { header, site, size } = self.encoder.branches[branch];
            let from = self.offset_of(site);
            for index in header.targets() {
                let to = self.target_of(self.words[site as usize + 1 + index]);
                let distance = to.wrapping_sub(from);
                debug_assert!(Size::of_distance(i64::from(distance as i32)) <= size);
                let start = self.encoder.layout_size + from as usize;
                put_distance(size, index, distance, &mut self.encoder.bytes[start..]);
            }
        }
    }

    /// Returns the new size.
    #[cold]
    fn widen_far_branches(&mut self, draft_size: u32) -> Result<u32, TooLarge> {
        // An instruction takes at most twice the bytes as `Wide16` and four times as `Wide32`.
        let max_growth = if draft_size <= 1 << 14 { 2 } else { 4 };
        self.encoder.far_branches.clear();
        for (index, branch) in self.encoder.branches.iter().enumerate() {
            let offset = self.words[branch.site as usize];
            let mut targets = [(offset, 0); MAX_TARGETS];
            let mut size = branch.size;
            for (target, operand) in targets.iter_mut().zip(branch.header.targets()) {
                target.0 = self.target_of(self.words[branch.site as usize + 1 + operand]);
                let distance = i64::from(target.0) - i64::from(offset);
                size = size.max(Size::of_distance(distance * max_growth));
            }
            if size > branch.size {
                self.encoder.far_branches.push(FarBranch {
                    branch: index as u32,
                    offset,
                    size,
                    growth: size.bytes(branch.header) - branch.size.bytes(branch.header),
                    targets,
                });
            }
        }

        let encoder = &mut self.encoder;
        encoder.sum_growth()?;
        for far in &mut encoder.far_branches {
            for (target, before) in &mut far.targets {
                *before = encoder
                    .shifts
                    .partition_point(|&(offset, _)| offset < *target)
                    as u32;
            }
        }
        for _ in 0..MAX_SHRINKING_PASSES {
            if !encoder.shrink() {
                break;
            }
            encoder.sum_growth()?;
        }
        encoder.far_branches.retain(|far| far.growth != 0);
        let size = draft_size
            .checked_add(encoder.sum_growth()?)
            .filter(|&size| size <= Body::MAX_SIZE)
            .ok_or(TooLarge)?;

        encoder.reserve(encoder.layout_size + size as usize)?;
        let code = &mut encoder.bytes[encoder.layout_size..];
        let mut end = draft_size as usize;
        for (far, &(offset, shift)) in encoder.far_branches.iter().zip(&encoder.shifts).rev() {
            let branch = &mut encoder.branches[far.branch as usize];
            let rest = (offset + branch.size.bytes(branch.header)) as usize;
            let start = (offset + shift) as usize;
            let operands = self.words[branch.site as usize + 1..]
                .first_chunk()
                .expect("grown");
            let metadata = u16::from_le_bytes([code[rest - 2], code[rest - 1]]);
            let mut bytes = InstructionBytes::default();
            let size = (far.size).put(branch.header, operands, u32::from(metadata), &mut bytes);
            code.copy_within(rest..end, start + size);
            code[start..start + size].copy_from_slice(&bytes[..size]);
            branch.size = far.size;
            end = offset as usize;
        }
        Ok(size)
    }

    fn handlers(&mut self) -> Box<[Handler]> {
        let mut ranges = core::mem::take(&mut self.try_ranges);
        ranges.retain(|range| self.is_referenced(range.handler));
        for range in &mut ranges {
            (range.start, range.end) = (self.offset_of(range.start), self.offset_of(range.end));
        }
        // Those of one depth are disjoint and ascend.
        ranges.sort_by_key(|range| core::cmp::Reverse(range.depth));
        ranges.dedup_by(|next: &mut TryRange, range: &mut TryRange| {
            let continues = (range.handler, range.kind, range.depth, range.end)
                == (next.handler, next.kind, next.depth, next.start);
            if continues {
                range.end = next.end;
            }
            continues
        });
        let handlers = ranges.iter().map(|range| Handler {
            range: range.start..range.end,
            target: self.target_of(range.handler.0),
            kind: range.kind,
        });
        let handlers = handlers.collect();
        self.try_ranges = ranges;
        handlers
    }

    fn may_have_tables(&self) -> bool {
        self.try_ranges.len()
            | self.int_switches.len()
            | self.string_switches.len()
            | self.spread_masks.len()
            | self.encoder.suspend_points.len()
            | self.coverage_blocks.len()
            | self.scope_registers.len()
            != 0
    }

    #[inline(never)]
    fn add_tables(&mut self, body: &mut Body) -> Result<(), TooLarge> {
        let handlers = self.handlers();
        if !self.may_have_tables() {
            return Ok(());
        }
        let mut int_switches: Box<[_]> = self.int_switches.drain(..).collect();
        for switch in &mut int_switches {
            switch.default = self.target_of(switch.default);
            match &mut switch.cases {
                IntCases::Dense { targets, .. } => targets
                    .iter_mut()
                    .for_each(|target| *target = self.target_of(*target)),
                IntCases::Sparse(cases) => cases
                    .iter_mut()
                    .for_each(|(_, target)| *target = self.target_of(*target)),
            }
        }
        let mut string_switches: Box<[_]> = self.string_switches.drain(..).collect();
        for StringSwitch { default, targets } in &mut string_switches {
            for target in targets.iter_mut().chain([default]) {
                *target = match *target {
                    NOWHERE => 0,
                    label => self.target_of(label),
                };
            }
        }
        let suspend_points = self.encoder.suspend_points.iter();
        let suspend_points = suspend_points.map(|&(suspend, resume, point)| {
            let (kind, registers) = self.suspensions[point as usize].clone();
            SuspendPoint {
                suspend: self.offset_of(suspend),
                resume: self.offset_of(resume),
                kind,
                registers,
            }
        });
        let kept = self.kept_registers.iter();
        body.tables = Some(Box::new(Tables {
            suspend_points: suspend_points.collect(),
            handlers,
            int_switches,
            string_switches,
            spread_masks: self.spread_masks.drain(..).collect(),
            saved_registers: kept
                .map(|&register| SavedRegister { register, word: 0 })
                .collect(),
            saved_words: 0,
            coverage_blocks: self.coverage_blocks.as_slice().into(),
            scope_registers: (self.scope_registers.iter())
                .map(|&(site, register)| (self.offset_of(site), register))
                .collect(),
        }));
        if self.suspensions.is_empty() {
            return Ok(());
        }
        self.encoder.saved_registers.fill_in(body)
    }
}
