use std::collections::BTreeMap;

/// Chunks beyond these have to be large.
const FREE_CHUNKS: usize = 256;
const MIN_AVERAGE_CHUNK_LEN: usize = 256;

#[derive(Debug)]
pub(crate) struct TooFragmented;

/// The bytes of a stream that arrived before they can be used.
#[derive(Default)]
pub(crate) struct Assembler {
    /// By offset. They do not overlap.
    chunks: BTreeMap<u64, Vec<u8>>,
    held: usize,
}

impl Assembler {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    /// Bytes that are there already stay as they are.
    pub(crate) fn insert(&mut self, mut offset: u64, mut data: &[u8]) -> Result<(), TooFragmented> {
        while !data.is_empty() {
            let next = self.chunks.range(offset + 1..).next();
            let room = next.map_or(u64::MAX, |(&start, _)| start - offset);
            let before = self.chunks.range_mut(..=offset).next_back();
            let before = before.map(|(&start, chunk)| (start + chunk.len() as u64, chunk));
            let len = match &before {
                &Some((end, _)) if end > offset => end - offset,
                _ => room,
            };
            let (piece, rest) = data.split_at(len.min(data.len() as u64) as usize);
            match before {
                Some((end, _)) if end > offset => {}
                Some((end, chunk)) if end == offset => {
                    chunk.extend_from_slice(piece);
                    self.held += piece.len();
                }
                _ => {
                    self.chunks.insert(offset, piece.to_vec());
                    self.held += piece.len();
                }
            }
            offset += piece.len() as u64;
            data = rest;
        }
        if self.chunks.len() > FREE_CHUNKS + self.held / MIN_AVERAGE_CHUNK_LEN {
            return Err(TooFragmented);
        }
        Ok(())
    }

    /// Takes the first chunk if it starts at or below `offset`, and returns where it starts.
    #[inline]
    pub(crate) fn pop(&mut self, offset: u64) -> Option<(u64, Vec<u8>)> {
        let first = self.chunks.first_entry()?;
        (*first.key() <= offset).then(|| {
            self.held -= first.get().len();
            first.remove_entry()
        })
    }
}
