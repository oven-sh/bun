//! Finds matches ahead of the search for a path.

use bun_highway::brotli::{
    Chunk, MATCH_CHUNK, MATCH_RING, MATCH_SCRATCH, MAX_RUNGS, Matches, Rung, find_matches,
};

use crate::encoder::input_block::InputBlock;
use crate::memory::{self, Result};

pub(super) type Starts = [Matches; MATCH_RING];

const SAMPLE: usize = 48;
/// The positions that get room on a mere hint.
const MAX_IN_ADVANCE: usize = 1 << 22;
const MAX_KEPT: usize = 400 << 10;

pub(super) struct Finder {
    rungs: [Rung; MAX_RUNGS],
    count: usize,
    lengths_for_text: [u32; 2],
    position_bits: u32,
    /// The tables are for two to the power of this many positions.
    room_bits: u32,
    noted: usize,
    tables: Vec<u64>,
    scratch: Box<[u64; MATCH_SCRATCH]>,
}

impl Finder {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            rungs: Default::default(),
            count: 0,
            lengths_for_text: [0; 2],
            position_bits: 0,
            room_bits: 0,
            noted: 0,
            tables: Vec::new(),
            scratch: memory::zeroed_array()?,
        })
    }

    pub(super) fn reset(&mut self) {
        (self.room_bits, self.noted) = (0, 0);
        if size_of_val(&*self.tables) > MAX_KEPT {
            self.tables = Vec::new();
        }
    }

    pub(super) fn restart_at(&mut self, position: usize) {
        self.rungs
            .iter_mut()
            .for_each(|rung| rung.next = position as u32);
    }

    /// For what follows `position`.
    pub(super) fn make_room(
        &mut self,
        block: &InputBlock<'_>,
        position: usize,
        is_text: bool,
    ) -> Result<()> {
        let (window_bits, is_quick) = (block.params.window_bits, block.params.quality == 10);
        let mut count = self.noted / 4 * 3 + block.end() - position;
        if !block.is_last && block.length == block.params.block_size() {
            count = count.max(block.params.size_hint.min(MAX_IN_ADVANCE));
        }
        let bits = (count.max(1024) - 1).bit_width().min(window_bits);
        let old = self.room_bits;
        if bits > old {
            let bits = if old == 0 {
                bits
            } else {
                bits.max(old + 2).min(window_bits)
            };
            // The length, the level, and how many bits fewer an index has.
            let ladder: &[[u32; 3]] = match bits {
                ..=12 => &[[3, 0, 0], [6, 0, 1], [16, 2, 2]],
                13..=15 if is_quick => &[[4, 0, 1], [7, 1, 2], [24, 3, 4]],
                21.. if is_quick => &[
                    [4, 0, 1],
                    [6, 0, 2],
                    [10, 1, 3],
                    [18, 2, 3],
                    [40, 3, 4],
                    [112, 4, 5],
                ],
                _ if is_quick => &[[4, 0, 1], [7, 0, 2], [14, 2, 3], [32, 3, 4], [96, 4, 5]],
                13..=15 => &[[4, 0, 0], [7, 0, 2], [12, 1, 3], [24, 2, 4], [56, 4, 5]],
                16..=20 => &[
                    [4, 0, 1],
                    [7, 0, 1],
                    [11, 1, 3],
                    [18, 2, 3],
                    [32, 2, 4],
                    [64, 3, 4],
                    [128, 4, 5],
                ],
                _ => &[
                    [4, 0, 1],
                    [6, 0, 2],
                    [9, 0, 2],
                    [14, 1, 3],
                    [24, 2, 3],
                    [48, 3, 4],
                    [128, 4, 5],
                ],
            };
            let mut total = 1;
            for (rung, &[length, level, smaller]) in self.rungs.iter_mut().zip(ladder) {
                let size_bits = (bits - smaller).min(if length <= 4 { 15 } else { 30 });
                *rung = Rung {
                    length,
                    level,
                    start: total,
                    size_bits,
                    next: 0,
                };
                total += 1 << size_bits;
            }
            if let Some(kept) = self.tables.get_mut(..total as usize) {
                kept.fill(0);
            } else {
                self.tables = Vec::new();
                self.tables = memory::zeroed(total as usize)?;
            }
            (self.room_bits, self.noted, self.count) = (bits, 0, ladder.len());
            let is_all = block.is_last && block.position == 0;
            self.position_bits = if is_all { bits } else { window_bits };
            self.lengths_for_text = [ladder[0][0], ladder[1][0]];
            self.restart_at(block.position.saturating_sub(1 << bits));
        }
        if self.room_bits > 12 {
            let lengths = if is_text {
                self.lengths_for_text
            } else {
                [3, 5]
            };
            [self.rungs[0].length, self.rungs[1].length] = lengths;
        }
        Ok(())
    }

    fn run(
        &mut self,
        block: &InputBlock<'_>,
        from: usize,
        to: usize,
        floor: Option<usize>,
        starts: &mut Starts,
    ) {
        self.noted += to.saturating_sub(from.max(self.rungs[0].next as usize));
        let max_distance = floor.map_or(0, |_| block.max_backward(to) as u32);
        let chunk = Chunk {
            ring_mask: block.window.index(usize::MAX) as u32,
            from: from as u32,
            to: to as u32,
            end: block.end() as u32,
            floor: floor.unwrap_or(from) as u32,
            origin: block.position as u32,
            max_distance,
            position_bits: self.position_bits,
            classes: [50, 70, 85].map(|percent| 1 << (max_distance.bit_width() * percent / 100)),
        };
        find_matches(
            block.window.bytes,
            &chunk,
            &mut self.rungs[..self.count],
            &mut self.tables,
            &mut self.scratch,
            starts,
        );
    }

    /// Takes note of what is before `position`, or of samples if a copy from `distance` ends there.
    #[inline(never)]
    pub(super) fn catch_up(
        &mut self,
        block: &InputBlock<'_>,
        position: usize,
        distance: Option<i32>,
        starts: &mut Starts,
    ) {
        let next = self.rungs[self.count - 1].next as usize;
        let (kept, period) =
            distance.map_or((position, 0), |distance| (1024, distance as u32 as usize));
        for from in
            (next.max(position.saturating_sub(kept + period))..position).step_by(MATCH_CHUNK)
        {
            let left = position - from;
            let length = if left > kept { SAMPLE } else { MATCH_CHUNK };
            self.run(block, from, from + left.min(length), None, starts);
        }
    }

    /// For matches that start at `floor` or later. Returns how far.
    #[inline(never)]
    pub(super) fn search(
        &mut self,
        block: &InputBlock<'_>,
        from: usize,
        floor: usize,
        starts: &mut Starts,
    ) -> usize {
        let to = block.end().min(from + MATCH_CHUNK);
        self.run(block, from, to, Some(floor), starts);
        to
    }
}
