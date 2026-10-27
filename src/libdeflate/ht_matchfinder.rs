//! Hash table matchfinder, for the fastest level: two candidates per hash and no matches under four bytes.

use crate::matchfinder::{
    Pos, WINDOW_SIZE, load_u32, lz_extend, lz_hash, new_table, node_pos, rebase,
};

const HASH_ORDER: u32 = 15;
const BUCKET_SIZE: usize = 2;

pub(crate) const MIN_MATCH_LEN: u32 = 4;
/// The least `max_len` that [`HtMatchfinder::longest_match`] takes.
pub(crate) const REQUIRED_NBYTES: u32 = 5;

pub(crate) struct HtMatchfinder {
    hash_tab: Box<[Pos; BUCKET_SIZE << HASH_ORDER]>,
    /// Nothing has been entered since the table was filled.
    is_clear: bool,
}

impl HtMatchfinder {
    pub(crate) fn new() -> Option<Self> {
        Some(Self {
            hash_tab: new_table()?,
            is_clear: true,
        })
    }

    pub(crate) fn init(&mut self) {
        if !core::mem::replace(&mut self.is_clear, false) {
            self.hash_tab.fill(crate::matchfinder::INITVAL);
        }
    }

    #[inline(always)]
    fn bucket(&mut self, hash: u32) -> Option<&mut [Pos; BUCKET_SIZE]> {
        self.hash_tab.as_chunks_mut().0.get_mut(hash as usize)
    }

    /// The length (0 for none) and offset of the longest match found at `in_next`.
    #[inline(always)]
    pub(crate) fn longest_match(
        &mut self,
        input: &[u8],
        in_base: &mut usize,
        in_next: usize,
        max_len: u32,
        nice_len: u32,
        next_hash: &mut u32,
    ) -> Option<(u32, u32)> {
        let mut cur_pos = in_next - *in_base;
        if cur_pos == WINDOW_SIZE {
            rebase(self.hash_tab.as_mut_slice());
            *in_base += WINDOW_SIZE;
            cur_pos = 0;
        }
        let in_base = *in_base;
        let cutoff = cur_pos as i32 - WINDOW_SIZE as i32;

        let hash = *next_hash;
        *next_hash = lz_hash(load_u32(input, in_next + 1)?, HASH_ORDER);
        let seq = load_u32(input, in_next)?;

        let bucket = self.bucket(hash)?;
        let first = i32::from(bucket[0]);
        bucket[0] = cur_pos as Pos;
        if first <= cutoff {
            return Some((0, 0));
        }
        let second = i32::from(bucket[1]);
        bucket[1] = first as Pos;

        let mut best_len = 0;
        let mut best_match_pos = in_next;
        let match_pos = node_pos(in_base, first);
        if load_u32(input, match_pos)? == seq {
            best_len = lz_extend(input, in_next, match_pos, 4, max_len)?;
            best_match_pos = match_pos;
            if second > cutoff && best_len < nice_len {
                let match_pos = node_pos(in_base, second);
                let tail = best_len as usize - 3;
                if load_u32(input, match_pos)? == seq
                    && load_u32(input, match_pos + tail)? == load_u32(input, in_next + tail)?
                {
                    let len = lz_extend(input, in_next, match_pos, 4, max_len)?;
                    if len > best_len {
                        best_len = len;
                        best_match_pos = match_pos;
                    }
                }
            }
        } else if second > cutoff {
            let match_pos = node_pos(in_base, second);
            if load_u32(input, match_pos)? == seq {
                best_len = lz_extend(input, in_next, match_pos, 4, max_len)?;
                best_match_pos = match_pos;
            }
        }
        Some((best_len, (in_next - best_match_pos) as u32))
    }

    /// Enters `count` positions from `in_next` on without looking for matches.
    #[inline(always)]
    pub(crate) fn skip_bytes(
        &mut self,
        input: &[u8],
        in_base: &mut usize,
        mut in_next: usize,
        count: u32,
        next_hash: &mut u32,
    ) -> Option<()> {
        if (count + REQUIRED_NBYTES) as usize > input.len() - in_next {
            return Some(());
        }

        let mut cur_pos = (in_next - *in_base) as i32;
        if cur_pos + count as i32 > WINDOW_SIZE as i32 {
            rebase(self.hash_tab.as_mut_slice());
            *in_base += WINDOW_SIZE;
            cur_pos -= WINDOW_SIZE as i32;
        }

        let mut hash = *next_hash;
        for _ in 0..count {
            let bucket = self.bucket(hash)?;
            bucket[1] = bucket[0];
            bucket[0] = cur_pos as Pos;

            in_next += 1;
            hash = lz_hash(load_u32(input, in_next)?, HASH_ORDER);
            cur_pos += 1;
        }
        *next_hash = hash;
        Some(())
    }
}
