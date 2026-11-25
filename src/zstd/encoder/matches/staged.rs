//! What the lower levels search with if the choice is theirs.

use bun_highway::zstd_stages::{INDEX_BITS, INDEX_GAP, SCRATCH_LEN, Searcher, Trend};
use bun_zstd_decoder::array::resize;
use bun_zstd_decoder::format::BLOCK_LEN_MAX;
use bun_zstd_decoder::{Error, Result};

use crate::levels::{Stages, stages_for};
use crate::sequences::{Repeats, Sequences};
use crate::vec;
use crate::window::History;

const REACH_MAX: usize = 1 << (INDEX_BITS - 1);

/// What frames can pass on.
#[derive(Default)]
pub(crate) struct Memory {
    /// All indices are below `next`, also where no table is.
    entries: Vec<u32>,
    scratch: Vec<u32>,
    /// The index of the next byte.
    next: usize,
}

impl Memory {
    pub(crate) fn held_len(&self) -> usize {
        self.entries.capacity() * size_of::<u32>()
    }

    /// Makes `kept` the index of the next byte.
    #[cold]
    fn lower_indices(&mut self, kept: usize) {
        let by = (self.next - kept) as u32;
        for entry in &mut self.entries {
            let is_kept = *entry % (1 << INDEX_BITS) >= by;
            *entry = if is_kept { entry.wrapping_sub(by) } else { 0 };
        }
        self.next = kept;
    }
}

pub(crate) struct Staged {
    level: i32,
    window_log: u32,
    /// Of the tables, which grow with the input if there is no telling how much is going to come.
    logs: [u32; 2],
    /// How many bytes have an index.
    seen: usize,
    trend: Trend,
}

impl Staged {
    pub(crate) fn new(level: i32, window_log: u32) -> Self {
        Self {
            level,
            window_log,
            logs: [0; 2],
            seen: 0,
            trend: Trend::UNKNOWN,
        }
    }

    pub(crate) fn is_at_start(&self) -> bool {
        self.seen == 0
    }

    pub(crate) fn needed_len(&self) -> usize {
        self.logs.iter().map(|&log| size_of::<u32>() << log).sum()
    }

    /// The table for short matches comes first.
    fn grow(&mut self, memory: &mut Memory, logs: [u32; 2]) -> Result<()> {
        let ([old_long, old_short], [long, short]) = (self.logs, logs);
        let len = (1 << long) + (1 << short);
        if self.seen == 0 && memory.entries.len() < len {
            memory.entries = Vec::new();
            memory.entries = vec::zeroed(len)?;
        } else if self.seen != 0 {
            if memory.entries.len() < len {
                vec::make_room(&mut memory.entries, len)?;
                resize(&mut memory.entries, len, 0);
            }
            // An entry goes everywhere it can belong.
            let tables = [
                (1 << old_short, 1 << short, long, long - old_long),
                (0, 0, short, short - old_short),
            ];
            for (from, to, log, shift) in tables {
                for at in (0..1usize << log).rev() {
                    let entry = memory.entries.get(from + (at >> shift)).copied();
                    if let Some((to, entry)) = memory.entries.get_mut(to + at).zip(entry) {
                        *to = entry;
                    }
                }
            }
        }
        self.logs = logs;
        Ok(())
    }

    /// For what is from `start` of `bytes` on. Also returns where that is in what the searcher has.
    fn searcher<'a>(
        &mut self,
        memory: &'a mut Memory,
        bytes: &'a [u8],
        start: usize,
        stages: &'a Stages,
    ) -> Result<(Searcher<'a>, usize)> {
        let ([long, short], len) = (self.logs, bytes.len().saturating_sub(start));
        let [long, short] = [long.max(stages.logs[0]), short.max(stages.logs[1])];
        if [long, short] != self.logs {
            self.grow(memory, [long, short])?;
        }
        vec::make_room(&mut memory.scratch, SCRATCH_LEN)?;
        if self.seen == 0 {
            memory.next += INDEX_GAP;
        }
        let max_distance = REACH_MAX.min(1 << self.window_log);
        let known = start.min(self.seen).min(max_distance);
        if memory.next + len > 1 << INDEX_BITS {
            memory.lower_indices(known + INDEX_GAP);
        }
        let index = (memory.next - known) as u32;
        (memory.next, self.seen) = (memory.next + len, self.seen.saturating_add(len));

        let tables = memory.entries.split_at_mut_checked(1 << short);
        let (short, rest) = tables.ok_or(Error::Internal)?;
        let searcher = Searcher {
            bytes: bytes.get(start - known..).ok_or(Error::Internal)?,
            index,
            max_distance: max_distance as u32,
            efforts: &stages.efforts,
            tables: [rest.get_mut(..1 << long).ok_or(Error::Internal)?, short],
            scratch: &mut memory.scratch,
        };
        Ok((searcher, known))
    }

    /// For what precedes the input.
    pub(crate) fn load(&mut self, memory: &mut Memory, earlier: &[u8]) -> Result<()> {
        let stages = stages_for(self.level, 1 << self.window_log);
        let start = earlier.len().saturating_sub(8 << stages.logs[0]);
        let (searcher, start) = self.searcher(memory, earlier, start, &stages)?;
        searcher.index(start).ok_or(Error::Internal)
    }

    pub(crate) fn skip(&mut self, memory: &mut Memory, len: usize) {
        if self.seen != 0 {
            (memory.next, self.seen) = (memory.next + len, self.seen.saturating_add(len));
        }
    }

    /// `total_len` is that of the frame. Returns how far the sequences go.
    pub(crate) fn search(
        &mut self,
        memory: &mut Memory,
        history: &History<'_>,
        total_len: Option<u64>,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
    ) -> Result<u32> {
        let len = history.block().len();
        let expected_len = match total_len {
            Some(len) => len,
            None if self.seen + len >= BLOCK_LEN_MAX => u64::MAX,
            None => BLOCK_LEN_MAX as u64,
        };
        let stages = stages_for(self.level, expected_len.min(1 << self.window_log));
        let (searcher, start) =
            self.searcher(memory, history.prefix, history.start as usize, &stages)?;
        sequences.fill(searcher, start, repeats, &mut self.trend)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indices_start_over_unnoticed() -> Result<()> {
        let words = (0..1500u32).map(|it| it.wrapping_mul(0x9E37_79B1) % 251);
        let bytes = words.map(|it| it as u8).collect::<Vec<_>>().repeat(4);
        let stages = stages_for(3, bytes.len() as u64);
        let frame = |memory: &mut Memory| {
            let (mut staged, mut sequences) = (Staged::new(3, 11), Sequences::new());
            let (mut all, mut repeats, mut trend) = (Vec::new(), Repeats::INITIAL, Trend::UNKNOWN);
            for start in (0..bytes.len()).step_by(1000) {
                sequences.clear_for(1000, 4)?;
                let bytes = bytes.get(..start + 1000).ok_or(Error::Internal)?;
                let (searcher, start) = staged.searcher(memory, bytes, start, &stages)?;
                sequences.fill(searcher, start, &mut repeats, &mut trend)?;
                all.extend_from_slice(bun_pod::cast_slice::<_, u8>(&sequences.list));
            }
            Ok::<_, Error>(all)
        };
        let mut memory = Memory::default();
        let expected = frame(&mut memory)?;
        assert!(!expected.is_empty());
        for left in (0..bytes.len() + 2 * INDEX_GAP).step_by(700) {
            memory.next = (1 << INDEX_BITS) - left - bytes.len() - INDEX_GAP;
            assert!(frame(&mut memory)? == expected && frame(&mut memory)? == expected);
            memory.entries.fill(0);
        }
        Ok(())
    }
}
