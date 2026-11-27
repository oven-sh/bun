//! Up to two symbols at a time.

use bun_highway::with_bmi2;

use super::ranks::Ranks;
use super::streams::{LOOKUPS, Lane, ROUNDS_MAX, Stream, Windows, interleave, prefetch, unload};
use super::{HuffmanWeights, QUICK_LOG};
use crate::array::At;
use crate::bounded::Bounded;
use crate::error::{Error, Result};
use crate::format::BLOCK_LEN_MAX;

use layout::Rows;

/// Loads are cheaper than shifts.
#[cfg(target_arch = "x86_64")]
mod layout {
    use super::super::rows::{FILL, fill_rows, repeat_each, repeat_rows_for};
    use super::super::{QUICK_LEN, QUICK_LOG};
    use crate::error::Result;

    pub(super) const COUNT_MAX: usize = 2;
    const PAIRS_IN_FILL: usize = FILL / 2;

    #[derive(Clone, Copy)]
    #[repr(u8)]
    enum Count {
        None,
        One,
        Two,
    }

    /// By the next [`QUICK_LOG`] bits: the one or two codes that they start with.
    #[repr(C)]
    pub(super) struct Rows {
        lengths: [u8; QUICK_LEN + FILL],
        counts: [Count; QUICK_LEN + FILL],
        symbols: [u16; QUICK_LEN + FILL],
    }

    impl Rows {
        pub(super) const EMPTY: Self = Self {
            lengths: [0; _],
            counts: [Count::None; _],
            symbols: [0; _],
        };

        #[inline(always)]
        pub(super) fn set_alone(
            &mut self,
            row: usize,
            repeats: usize,
            symbols: &[u8],
            length: u32,
        ) -> Result<()> {
            let rows = symbols.len() * repeats;
            fill_rows::<_, FILL>(&mut self.lengths, row, rows, length as u8)?;
            fill_rows::<_, FILL>(&mut self.counts, row, rows, Count::One)?;
            // The second does not count. This one is the quickest to repeat.
            let alone = |symbol| u16::from_le_bytes([symbol; 2]);
            repeat_each::<_, PAIRS_IN_FILL>(&mut self.symbols, row, symbols, repeats, alone)
        }

        #[inline(always)]
        pub(super) fn set_pairs(
            &mut self,
            row: usize,
            repeats: usize,
            first: u8,
            seconds: &[u8],
            length: u32,
        ) -> Result<()> {
            let rows = seconds.len() * repeats;
            fill_rows::<_, FILL>(&mut self.lengths, row, rows, length as u8)?;
            fill_rows::<_, FILL>(&mut self.counts, row, rows, Count::Two)?;
            let pair = |second| u16::from_le_bytes([first, second]);
            repeat_each::<_, PAIRS_IN_FILL>(&mut self.symbols, row, seconds, repeats, pair)
        }

        #[inline(always)]
        pub(super) fn repeat_for(
            &mut self,
            others: &[u8],
            start: usize,
            period: usize,
        ) -> Result<()> {
            repeat_rows_for::<_, FILL>(&mut self.lengths, start, period, others, |it, _| it)?;
            repeat_rows_for::<_, FILL>(&mut self.counts, start, period, others, |it, _| it)?;
            let with_first = |pair, first| pair & 0xFF00 | u16::from(first);
            repeat_rows_for::<_, PAIRS_IN_FILL>(
                &mut self.symbols,
                start,
                period,
                others,
                with_first,
            )
        }

        /// The row for what `bits` start with, and how many of them it takes.
        #[inline(always)]
        pub(super) fn find(&self, bits: u64) -> (usize, u8) {
            let row = (bits >> (64 - QUICK_LOG)) as usize;
            (row, self.lengths.get(row).copied().unwrap_or_default())
        }

        #[inline(always)]
        pub(super) fn symbols(&self, row: usize) -> u16 {
            self.symbols.get(row).copied().unwrap_or_default()
        }

        #[inline(always)]
        pub(super) fn count(&self, row: usize) -> usize {
            self.counts.get(row).map_or(0, |&it| it as usize)
        }
    }
}

/// Shifts are cheaper than loads.
#[cfg(not(target_arch = "x86_64"))]
mod layout {
    use super::super::rows::{FILL, repeat_each, repeat_rows_for};
    use super::super::{QUICK_LEN, QUICK_LOG};
    use crate::error::Result;

    /// As far as the compiler can tell.
    pub(super) const COUNT_MAX: usize = 3;
    const ROWS_IN_FILL: usize = FILL / 4;
    const SYMBOLS_SHIFT: u32 = 14;
    const COUNT_SHIFT: u32 = 30;

    /// By the next [`QUICK_LOG`] bits: the length, the symbols and the count of the one or two codes that they start with.
    pub(super) struct Rows([u32; QUICK_LEN + ROWS_IN_FILL]);

    impl Rows {
        pub(super) const EMPTY: Self = Self([0; _]);

        #[inline(always)]
        pub(super) fn set_alone(
            &mut self,
            row: usize,
            repeats: usize,
            symbols: &[u8],
            length: u32,
        ) -> Result<()> {
            let alone = |symbol| length | u32::from(symbol) << SYMBOLS_SHIFT | 1 << COUNT_SHIFT;
            repeat_each::<_, ROWS_IN_FILL>(&mut self.0, row, symbols, repeats, alone)
        }

        #[inline(always)]
        pub(super) fn set_pairs(
            &mut self,
            row: usize,
            repeats: usize,
            first: u8,
            seconds: &[u8],
            length: u32,
        ) -> Result<()> {
            let value = length | u32::from(first) << SYMBOLS_SHIFT | 2 << COUNT_SHIFT;
            let pair = |second| value | u32::from(second) << (SYMBOLS_SHIFT + 8);
            repeat_each::<_, ROWS_IN_FILL>(&mut self.0, row, seconds, repeats, pair)
        }

        #[inline(always)]
        pub(super) fn repeat_for(
            &mut self,
            others: &[u8],
            start: usize,
            period: usize,
        ) -> Result<()> {
            let with_first =
                |row, first| row & !(0xFF << SYMBOLS_SHIFT) | u32::from(first) << SYMBOLS_SHIFT;
            repeat_rows_for::<_, ROWS_IN_FILL>(&mut self.0, start, period, others, with_first)
        }

        /// The row for what `bits` start with, and how many of them it takes.
        #[inline(always)]
        pub(super) fn find(&self, bits: u64) -> (usize, u8) {
            let row = self.0.get((bits >> (64 - QUICK_LOG)) as usize);
            let row = row.copied().unwrap_or_default();
            (row as usize, row as u8)
        }

        #[inline(always)]
        pub(super) fn symbols(&self, row: usize) -> u16 {
            (row >> SYMBOLS_SHIFT) as u16
        }

        #[inline(always)]
        pub(super) fn count(&self, row: usize) -> usize {
            row >> COUNT_SHIFT
        }
    }
}

/// How far a round writes at most.
const ROUND_ROOM: usize = (LOOKUPS - 1) * layout::COUNT_MAX + 2;

/// In which a round can start at any position that has as many bits as those in a block.
pub(crate) const AMPLE_ROOM: usize = BLOCK_LEN_MAX + ROUND_ROOM;

/// With less left to fill, a lane is through.
const ROOM_MIN: usize = 4 * LOOKUPS;

/// Lanes that are through repeat what another does. Returns the least room of a busy one, or 0 if there are not two.
#[inline(never)]
fn follow_a_busy_lane(lanes: &mut [Lane; 4], rooms: [usize; 4]) -> usize {
    let mut busy = (0..4).filter(|&lane| *rooms.at(lane) >= ROOM_MIN);
    let (Some(leader), Some(_)) = (busy.next(), busy.next()) else {
        return 0;
    };
    let leader = *lanes.at(leader);
    let mut least = usize::MAX;
    for (lane, &room) in lanes.iter_mut().zip(&rooms) {
        if room < ROOM_MIN {
            *lane = leader;
        } else {
            least = least.min(room);
        }
    }
    least
}

#[repr(C)]
pub(super) struct PairTable {
    rows: Rows,
    lengths_by_symbol: [u8; 256],
}

impl PairTable {
    pub(super) const EMPTY: Self = Self {
        rows: Rows::EMPTY,
        lengths_by_symbol: [0; _],
    };

    #[inline(always)]
    pub(super) fn fill(&mut self, tree: &HuffmanWeights, ranks: &Ranks<'_>) -> Result<()> {
        for (length, weight) in self.lengths_by_symbol.iter_mut().zip(&tree.weights) {
            *length = (tree.table_log as u8).plus(1).wrapping_sub(*weight);
        }
        let mut row = 0;
        for (length, firsts) in ranks.up_to(QUICK_LOG) {
            let Some((&first, others)) = firsts.split_first() else {
                continue;
            };
            let (start, room) = (row, QUICK_LOG - length);
            let period = 1 << room;
            let alone = ranks.rows_beyond(room) >> length;
            if alone == period {
                self.rows.set_alone(row, alone, firsts, length)?;
                row += firsts.len() * alone;
                continue;
            }
            self.rows.set_alone(row, alone, &[first], length)?;
            row += alone;
            for (second_length, seconds) in ranks.up_to(room) {
                let repeats = 1 << (room - second_length);
                self.rows
                    .set_pairs(row, repeats, first, seconds, length + second_length)?;
                row += seconds.len() * repeats;
            }
            // What can follow a code depends on nothing but its length.
            if !others.is_empty() {
                self.rows.repeat_for(others, start, period)?;
                row += others.len() * period;
            }
        }
        Ok(())
    }

    /// The first symbol that `bits` start with, and the length of its code.
    #[inline(always)]
    pub(super) fn first(&self, bits: u64) -> (u8, u8) {
        let symbol = self.rows.symbols(self.rows.find(bits).0) as u8;
        (symbol, *self.lengths_by_symbol.at(symbol.into()))
    }

    /// At `position` of `out`, which it moves on.
    #[inline(always)]
    fn write<const N: usize>(&self, row: usize, out: &mut [u8; N], position: &mut usize) {
        if let Some(pair) = out.get_mut(*position..).and_then(<[u8]>::first_chunk_mut) {
            *pair = self.rows.symbols(row).to_le_bytes();
        }
        *position += self.rows.count(row);
    }

    /// Returns what is left to fill of `out`.
    #[inline(always)]
    pub(super) fn decode<'o>(
        &self,
        src: &[u8],
        stream: &mut Stream,
        mut out: &'o mut [u8],
    ) -> &'o mut [u8] {
        while let Some(loaded) = Stream::load(src, stream.position)
            && let Some(round) = out.first_chunk_mut::<ROUND_ROOM>()
        {
            let mut len = 0;
            for lookup in 0..LOOKUPS {
                let (row, length) = self.rows.find(stream.bits);
                if lookup == 0 {
                    stream.bits = loaded;
                }
                stream.skip(length);
                self.write(row, round, &mut len);
            }
            out = out.get_mut(len..).unwrap_or_default();
        }
        out
    }

    /// Leaves in `outs` what is left to fill.
    pub(super) fn decode_4(
        &self,
        windows: &Windows<'_>,
        lanes: &mut [Lane; 4],
        outs: &mut [&mut [u8]; 4],
    ) -> Result<()> {
        with_bmi2(
            #[inline(always)]
            move || {
                let mut stages = [[0; 256 + ROUND_ROOM]; 4];
                let mut working = *lanes;
                loop {
                    let [a, b, c, d] = &*outs;
                    let rooms @ [a, b, c, d] = [a.len(), b.len(), c.len(), d.len()];
                    let mut room = a.min(b).min(c).min(d);
                    if room < ROOM_MIN {
                        room = follow_a_busy_lane(&mut working, rooms);
                        if room == 0 {
                            return Ok(());
                        }
                    }
                    let mut lens = [0; 4];
                    interleave(
                        windows,
                        &mut working,
                        room.min(255) / (2 * LOOKUPS),
                        #[inline(always)]
                        |bits| self.rows.find(bits),
                        #[inline(always)]
                        |lane, _, lookup, row| {
                            let len = lens.at_mut(lane);
                            if lookup == 0 {
                                *len %= 256;
                            }
                            self.write(row, stages.at_mut(lane), len);
                        },
                    )?;
                    for (lane, out) in outs.iter_mut().enumerate() {
                        if out.len() >= ROOM_MIN {
                            let stage = stages.at(lane).as_chunks().0.first_chunk::<2>();
                            unload(stage.ok_or(Error::Internal)?, *lens.at(lane), out)?;
                            *lanes.at_mut(lane) = *working.at(lane);
                        }
                    }
                }
            },
        )
    }

    /// From `positions`, which it moves on, until one is close to its end.
    pub(super) fn decode_4_in_place(
        &self,
        windows: &Windows<'_>,
        lanes: &mut [Lane; 4],
        out: &mut [u8; AMPLE_ROOM],
        positions: &mut [usize; 4],
        ends: &[usize; 4],
        prefetch_lead: usize,
    ) -> Result<()> {
        with_bmi2(
            #[inline(always)]
            move || {
                let mut at = *positions;
                loop {
                    let room = |lane| ends.at(lane).saturating_sub(*at.at(lane));
                    let rounds = room(0).min(room(1)).min(room(2)).min(room(3)) / (2 * LOOKUPS);
                    if rounds < ROUNDS_MAX / 4 {
                        *positions = at;
                        return Ok(());
                    }
                    for at in at {
                        let ahead = out.as_ptr().wrapping_add(at).wrapping_add(prefetch_lead);
                        prefetch(ahead, ROUNDS_MAX * 2 * LOOKUPS);
                    }
                    interleave(
                        windows,
                        lanes,
                        rounds,
                        #[inline(always)]
                        |bits| self.rows.find(bits),
                        #[inline(always)]
                        |lane, _, lookup, row| {
                            let position = at.at_mut(lane);
                            if lookup == 0 {
                                *position %= BLOCK_LEN_MAX;
                            }
                            self.write(row, out, position);
                        },
                    )?;
                }
            },
        )
    }
}
