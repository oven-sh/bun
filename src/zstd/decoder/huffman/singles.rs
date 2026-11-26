//! One symbol at a time.

use bun_highway::with_bmi2;

use super::streams::{LOOKUPS, Lane, ROUNDS_MAX, Stream, Windows, interleave, prefetch, unload};
use super::{QUICK_LEN, QUICK_LOG};
use crate::array::At;
use crate::error::Result;

/// By the next `log` bits: the code that they start with.
#[derive(Clone, Copy)]
pub(super) struct SingleTable<'a> {
    /// The lengths, then the symbols.
    pub(super) rows: &'a [[u8; QUICK_LEN]; 2],
    pub(super) log: u32,
}

impl SingleTable<'_> {
    /// From 64 bits to a row. The compiler knows that there is one.
    #[inline(always)]
    fn shift(self) -> u32 {
        64u32.wrapping_sub(self.log).clamp(64 - QUICK_LOG, 63)
    }

    /// Returns what is left to fill of `out`.
    #[inline(always)]
    pub(super) fn decode<'o>(
        self,
        src: &[u8],
        stream: &mut Stream,
        mut out: &'o mut [u8],
    ) -> &'o mut [u8] {
        let ([lengths, symbols], shift) = (self.rows, self.shift());
        while let Some(loaded) = Stream::load(src, stream.position)
            && let Some(round) = out.first_chunk_mut::<LOOKUPS>()
        {
            for (lookup, symbol) in round.iter_mut().enumerate() {
                let row = (stream.bits >> shift) as usize;
                if lookup == 0 {
                    stream.bits = loaded;
                }
                stream.skip(*lengths.at(row));
                *symbol = *symbols.at(row);
            }
            out = out.get_mut(LOOKUPS..).unwrap_or_default();
        }
        out
    }

    /// Leaves in `outs`, the last of which is the shortest, what is left to fill.
    pub(super) fn decode_4(
        self,
        windows: &Windows<'_>,
        lanes: &mut [Lane; 4],
        outs: &mut [&mut [u8]; 4],
        prefetch_lead: usize,
    ) -> Result<()> {
        with_bmi2(
            #[inline(always)]
            move || {
                let ([lengths, symbols], shift) = (self.rows, self.shift());
                // Four places to write to would take too many registers.
                let mut stages = [[[0; ROUNDS_MAX * LOOKUPS]]; 4];
                let mut left = outs[3].len() / LOOKUPS;
                while left != 0 {
                    let rounds = (left - 1) % ROUNDS_MAX + 1;
                    interleave(
                        windows,
                        lanes,
                        rounds,
                        #[inline(always)]
                        |bits| {
                            (
                                (bits >> shift) as usize,
                                *lengths.at((bits >> shift) as usize),
                            )
                        },
                        #[inline(always)]
                        |lane, round, lookup, row| {
                            let [stage] = stages.at_mut(lane);
                            *stage.at_mut(round * LOOKUPS + lookup) = *symbols.at(row);
                        },
                    )?;
                    for (stage, out) in stages.iter().zip(&mut *outs) {
                        prefetch(out.as_ptr().wrapping_add(prefetch_lead), size_of_val(stage));
                        unload(stage, rounds * LOOKUPS, out)?;
                    }
                    left -= rounds;
                }
                Ok(())
            },
        )
    }
}
