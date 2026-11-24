use std::collections::BTreeMap;

/// Chunks beyond these have to be long.
const FREE_CHUNKS: usize = 64;
const MIN_CHUNK_LEN: usize = 256;
/// A longer chunk stays apart from the one that it follows.
const MAX_MOVED_LEN: usize = 2048;
const BLOCK_LEN: u64 = u128::BITS as u64;

/// The bytes of a stream that arrived before they can be used.
#[derive(Default)]
pub(crate) struct Assembler {
    /// By offset. They overlap neither each other nor what the blocks have.
    chunks: BTreeMap<u64, Vec<u8>>,
    blocks: Option<Box<Blocks>>,
}

struct Block {
    present: u128,
    bytes: [u8; BLOCK_LEN as usize],
}

/// By offset. For short pieces with gaps between them.
#[derive(Default)]
struct Blocks(BTreeMap<u64, Box<Block>>);

impl Blocks {
    fn insert(&mut self, mut offset: u64, mut data: &[u8]) {
        while !data.is_empty() {
            let at = offset % BLOCK_LEN;
            let (piece, rest) = data.split_at(data.len().min((BLOCK_LEN - at) as usize));
            let block = self.0.entry(offset - at).or_insert_with(|| {
                Box::new(Block {
                    present: 0,
                    bytes: [0; _],
                })
            });
            let bytes = block.bytes.iter_mut().skip(at as usize);
            for ((to, from), bit) in bytes.zip(piece).zip(at..) {
                if block.present >> bit & 1 == 0 {
                    block.present |= 1 << bit;
                    *to = *from;
                }
            }
            (offset, data) = (offset + piece.len() as u64, rest);
        }
    }

    /// Of the bytes from `offset` on, as far as `to` reaches.
    fn move_to(&mut self, offset: u64, to: &mut [u8]) {
        let end = offset + to.len() as u64;
        let emptied = (self.0).extract_if(offset - offset % BLOCK_LEN..end, |start, block| {
            let mut moved = block.present
                & u128::MAX << offset.saturating_sub(*start)
                & u128::MAX >> (start + BLOCK_LEN).saturating_sub(end);
            block.present ^= moved;
            while let Some(bit) = moved.lowest_one()
                && let Some(from) = block.bytes.get(bit as usize)
                && let Some(to) = to.get_mut((start + u64::from(bit) - offset) as usize)
            {
                *to = *from;
                moved ^= 1 << bit;
            }
            block.present == 0
        });
        emptied.for_each(drop);
    }

    fn forget_below(&mut self, offset: u64) {
        while let Some(first) = self.0.first_entry()
            && let known = offset.saturating_sub(*first.key()).min(BLOCK_LEN)
            && first.get().present.unbounded_shr(known as u32) == 0
        {
            first.remove();
        }
    }

    fn next_gap(&self, mut offset: u64) -> u64 {
        while let Some(block) = self.0.get(&(offset - offset % BLOCK_LEN))
            && let len @ 1.. = (block.present >> (offset % BLOCK_LEN)).trailing_ones()
        {
            offset += u64::from(len);
        }
        offset
    }
}

impl Assembler {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.chunks.is_empty() && self.blocks.is_none()
    }

    /// How far short pieces reach, with the gaps around them, that did not fit in the chunks.
    pub(crate) fn scattered_len(&self) -> u64 {
        (self.blocks.as_ref()).map_or(0, |it| it.0.len() as u64 * BLOCK_LEN)
    }

    /// Bytes that are there already stay as they are.
    pub(crate) fn insert(&mut self, mut offset: u64, mut data: &[u8]) {
        while !data.is_empty() {
            let is_full = self.chunks.len() >= FREE_CHUNKS;
            let next = self.chunks.range(offset + 1..).next();
            let room = next.map_or(u64::MAX, |(&start, _)| start - offset);
            let is_next_short = next.is_some_and(|it| it.1.len() <= MAX_MOVED_LEN);
            let before = self.chunks.range_mut(..=offset).next_back();
            let before = before.map(|(&start, chunk)| (start + chunk.len() as u64, chunk));
            let len = match &before {
                &Some((end, _)) if end > offset => end - offset,
                _ => room,
            };
            let (piece, rest) = data.split_at(len.min(data.len() as u64) as usize);
            let joins_next = is_next_short && piece.len() as u64 == room;
            let chunk = match before {
                Some((end, _)) if end > offset => None,
                Some((end, chunk)) if end == offset => Some(chunk),
                _ if is_full && !joins_next && piece.len() < MIN_CHUNK_LEN => {
                    self.blocks.get_or_insert_default().insert(offset, piece);
                    None
                }
                _ => Some(self.chunks.entry(offset).or_default()),
            };
            if let Some(chunk) = chunk {
                let old_len = chunk.len();
                chunk.extend_from_slice(piece);
                if let (Some(blocks), Some(new)) = (&mut self.blocks, chunk.get_mut(old_len..)) {
                    blocks.move_to(offset, new);
                }
            }
            offset += piece.len() as u64;
            data = rest;
            if joins_next
                && let Some(next) = self.chunks.remove(&offset)
                && let Some((_, chunk)) = self.chunks.range_mut(..offset).next_back()
            {
                chunk.extend_from_slice(&next);
            }
        }
    }

    /// Takes a chunk that starts at or below `offset`, and returns where it starts.
    #[inline]
    pub(crate) fn pop(&mut self, offset: u64) -> Option<(u64, Vec<u8>)> {
        if let Some(first) = self.chunks.first_entry()
            && *first.key() <= offset
        {
            return Some(first.remove_entry());
        }
        let blocks = self.blocks.as_mut()?;
        let mut chunk = vec![0; (blocks.next_gap(offset) - offset) as usize];
        blocks.move_to(offset, &mut chunk);
        blocks.forget_below(offset);
        self.blocks.take_if(|it| it.0.is_empty());
        (!chunk.is_empty()).then_some((offset, chunk))
    }

    /// Undoes [`Self::pop`]. The first `used` bytes are not needed any more.
    pub(crate) fn put_back(&mut self, mut offset: u64, mut chunk: Vec<u8>, used: usize) {
        if used > chunk.len() / 2 {
            (offset, chunk) = (offset + used as u64, chunk.split_off(used));
        }
        self.chunks.insert(offset, chunk);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::range_set::RangeSet;

    #[test]
    fn used_part_of_a_chunk_is_dropped() {
        let (mut assembler, mut read) = (Assembler::default(), 0);
        for end in (0..100_000).step_by(1000) {
            assembler.insert(end, &[0; 1000]);
            let (offset, chunk) = assembler.pop(read).unwrap_or_default();
            read = end + 999;
            assembler.put_back(offset, chunk, (read - offset) as usize);
            assert!(assembler.chunks.values().map(Vec::len).eq([1]));
        }
    }

    fn full_from(offset: u64) -> Assembler {
        let mut assembler = Assembler::default();
        (0..FREE_CHUNKS as u64).for_each(|it| assembler.insert(offset + 2 * it, &[0]));
        assembler
    }

    #[test]
    fn short_pieces_share_blocks() {
        for (step, len, chunks, blocks) in [
            (2, 1, 0, 2),
            (64, 63, 0, 50),
            (128, 1, 0, 100),
            (256, 255, 0, 200),
            (257, 256, 100, 0),
        ] {
            let mut assembler = full_from(1 << 20);
            (0..100).for_each(|it| assembler.insert(1 + it * step, &vec![0; len]));
            assert_eq!(assembler.chunks.len(), FREE_CHUNKS + chunks);
            assert_eq!(assembler.scattered_len(), blocks * BLOCK_LEN);
        }
    }

    #[test]
    fn short_pieces_join_chunks() {
        let mut assembler = full_from(10);
        assembler.insert(9, &[1]);
        assembler.insert(137, &[1]);
        assert!(assembler.blocks.is_none());
        assert_eq!(assembler.pop(9), Some((9, vec![1, 0])));
    }

    #[test]
    fn blocks_that_are_passed_are_dropped() {
        for (read, left) in [(300, 1), (301, 1), (499, 1), (501, 0), (500 + (1 << 32), 0)] {
            let mut assembler = full_from(1);
            assembler.insert(300, &[0]);
            assembler.insert(500, &[0]);
            while assembler.pop(read).is_some() {}
            assert_eq!(assembler.scattered_len(), left * BLOCK_LEN);
            assert_eq!(assembler.is_empty(), left == 0);
        }
    }

    #[test]
    fn neighboring_blocks_come_out_together() {
        let mut assembler = full_from(1000);
        (0..5).for_each(|it| assembler.insert(10 + 100 * it, &[1; 100]));
        assembler.insert(511, &[2]);
        assert_eq!(assembler.pop(20), Some((20, vec![1; 490])));
        assert_eq!(assembler.pop(20), None);
        assert_eq!(assembler.pop(511), Some((511, vec![2])));
    }

    #[test]
    fn bytes_are_kept_once() {
        let mut assembler = full_from(1000);
        assembler.insert(126, &[1; 4]);
        assembler.insert(125, &[2; 6]);
        assembler.insert(127, &[3; MIN_CHUNK_LEN]);
        assert_eq!(assembler.scattered_len(), BLOCK_LEN);
        assert_eq!(assembler.pop(125), Some((125, vec![2, 1])));
        let (offset, chunk) = assembler.pop(127).unwrap_or_default();
        assert_eq!((offset, chunk.len()), (127, MIN_CHUNK_LEN));
        assert!(chunk.starts_with(&[1, 1, 1, 2, 3]));
    }

    #[test]
    fn pieces_come_out_in_order() {
        let stream = (0..50_000u32)
            .map(|it| (it % 251) as u8)
            .collect::<Vec<_>>();
        let mut random = 1u64;
        let mut below = |limit: usize| {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            (random >> 33) as usize % limit
        };
        for max_len in [2, 20, 300, 3000] {
            let (mut assembler, mut read) = (Assembler::default(), Vec::<u8>::new());
            let mut inserted = RangeSet::default();
            while read.len() < stream.len() {
                let offset = match below(40) {
                    0 => read.len(),
                    _ => (read.len() + below(20_000)).min(stream.len() - 1),
                };
                let end = (offset + 1 + below(max_len)).min(stream.len());
                assembler.insert(offset as u64, stream.get(offset..end).unwrap_or_default());
                inserted.insert(offset as u64..end as u64);
                let mut is_drained = true;
                while is_drained && let Some((offset, chunk)) = assembler.pop(read.len() as u64) {
                    let new = chunk.get(read.len() - offset as usize..);
                    let new = new.unwrap_or_default();
                    let used = below(4 * new.len() + 1).min(new.len());
                    read.extend(new.iter().take(used));
                    is_drained = used == new.len();
                    if !is_drained {
                        assembler.put_back(offset, chunk, read.len() - offset as usize);
                    }
                }
                assert!(!is_drained || !inserted.contains(read.len() as u64));
            }
            while assembler.pop(read.len() as u64).is_some() {}
            assert!(read == stream && assembler.is_empty());
        }
    }
}
