//! Binary trees matchfinder, for levels 10 to 12. Positions whose first four bytes hash alike form a sorted tree.

use crate::matchfinder::{
    INITVAL, Pos, WINDOW_SIZE, load_u24, load_u32, lz_extend, lz_hash, new_table, node_pos, rebase,
};

const HASH3_ORDER: u32 = 16;
const HASH3_WAYS: usize = 2;
const HASH4_ORDER: u32 = 16;

/// The least `max_len` that [`BtMatchfinder::get_matches`] and [`BtMatchfinder::skip_byte`] take.
pub(crate) const REQUIRED_NBYTES: u32 = 5;

#[derive(Clone, Copy)]
pub(crate) struct LzMatch {
    pub(crate) length: u16,
    pub(crate) offset: u16,
}

pub(crate) struct BtMatchfinder {
    hash3_tab: Box<[Pos; HASH3_WAYS << HASH3_ORDER]>,
    hash4_tab: Box<[Pos; 1 << HASH4_ORDER]>,
    /// The children of the node at position `pos` are `child_tab[pos * 2]` and `child_tab[pos * 2 + 1]`.
    child_tab: Box<[Pos; 2 * WINDOW_SIZE]>,
    /// Nothing has been entered since the hash tables were filled.
    is_clear: bool,
}

#[inline(always)]
fn left_child(node: i32) -> usize {
    2 * (node as usize & (WINDOW_SIZE - 1))
}

#[inline(always)]
fn right_child(node: i32) -> usize {
    left_child(node) + 1
}

impl BtMatchfinder {
    pub(crate) fn new() -> Option<Self> {
        Some(Self {
            hash3_tab: new_table()?,
            hash4_tab: new_table()?,
            child_tab: new_table()?,
            is_clear: true,
        })
    }

    pub(crate) fn init(&mut self) {
        if !core::mem::replace(&mut self.is_clear, false) {
            self.hash3_tab.fill(INITVAL);
            self.hash4_tab.fill(INITVAL);
        }
    }

    pub(crate) fn slide_window(&mut self) {
        rebase(self.hash3_tab.as_mut_slice());
        rebase(self.hash4_tab.as_mut_slice());
        rebase(self.child_tab.as_mut_slice());
    }

    #[inline(always)]
    fn child(&self, index: usize) -> Option<Pos> {
        self.child_tab.get(index).copied()
    }

    #[inline(always)]
    fn set_child(&mut self, index: usize, node: Pos) -> Option<()> {
        *self.child_tab.get_mut(index)? = node;
        Some(())
    }

    /// Enters the position `in_base + cur_pos`, and appends its matches to `matches` if there is one.
    #[inline(always)]
    fn advance_one_byte(
        &mut self,
        input: &[u8],
        in_base: usize,
        cur_pos: usize,
        max_len: u32,
        nice_len: u32,
        max_search_depth: u32,
        next_hashes: &mut [u32; 2],
        mut matches: Option<&mut Vec<LzMatch>>,
    ) -> Option<()> {
        let in_next = in_base + cur_pos;
        let mut depth_remaining = max_search_depth;
        let cutoff = cur_pos as i32 - WINDOW_SIZE as i32;
        let mut best_len = 3;

        let lz_match = |length: u32, match_pos: usize| LzMatch {
            length: length as u16,
            offset: (in_next - match_pos) as u16,
        };

        let next_hashseq = load_u32(input, in_next + 1)?;
        let [hash3, hash4] = *next_hashes;
        *next_hashes = [
            lz_hash(next_hashseq & 0xFF_FFFF, HASH3_ORDER),
            lz_hash(next_hashseq, HASH4_ORDER),
        ];

        let ways: &mut [Pos; HASH3_WAYS] =
            self.hash3_tab.as_chunks_mut().0.get_mut(hash3 as usize)?;
        let cur_node = i32::from(ways[0]);
        let cur_node_2 = i32::from(ways[1]);
        *ways = [cur_pos as Pos, cur_node as Pos];
        if let Some(matches) = &mut matches
            && cur_node > cutoff
        {
            let seq3 = load_u24(input, in_next)?;
            if seq3 == load_u24(input, node_pos(in_base, cur_node))? {
                matches.push(lz_match(3, node_pos(in_base, cur_node)));
            } else if cur_node_2 > cutoff && seq3 == load_u24(input, node_pos(in_base, cur_node_2))?
            {
                matches.push(lz_match(3, node_pos(in_base, cur_node_2)));
            }
        }

        let slot4 = self.hash4_tab.get_mut(hash4 as usize)?;
        let mut cur_node = i32::from(core::mem::replace(slot4, cur_pos as Pos));

        // Where to hang the next node found to sort before, and after, the new one.
        let mut pending_lt = left_child(cur_pos as i32);
        let mut pending_gt = right_child(cur_pos as i32);

        if cur_node <= cutoff {
            self.set_child(pending_lt, INITVAL)?;
            self.set_child(pending_gt, INITVAL)?;
            return Some(());
        }

        let mut best_lt_len = 0;
        let mut best_gt_len = 0;
        let mut len = 0u32;

        loop {
            let match_pos = node_pos(in_base, cur_node);

            if input.get(match_pos + len as usize)? == input.get(in_next + len as usize)? {
                len = lz_extend(input, in_next, match_pos, len + 1, max_len)?;
                if matches.is_none() || len > best_len {
                    if let Some(matches) = &mut matches {
                        best_len = len;
                        matches.push(lz_match(len, match_pos));
                    }
                    if len >= nice_len {
                        self.set_child(pending_lt, self.child(left_child(cur_node))?)?;
                        self.set_child(pending_gt, self.child(right_child(cur_node))?)?;
                        return Some(());
                    }
                }
            }

            if input.get(match_pos + len as usize)? < input.get(in_next + len as usize)? {
                self.set_child(pending_lt, cur_node as Pos)?;
                pending_lt = right_child(cur_node);
                cur_node = i32::from(self.child(pending_lt)?);
                best_lt_len = len;
                if best_gt_len < len {
                    len = best_gt_len;
                }
            } else {
                self.set_child(pending_gt, cur_node as Pos)?;
                pending_gt = left_child(cur_node);
                cur_node = i32::from(self.child(pending_gt)?);
                best_gt_len = len;
                if best_lt_len < len {
                    len = best_lt_len;
                }
            }

            depth_remaining -= 1;
            if cur_node <= cutoff || depth_remaining == 0 {
                self.set_child(pending_lt, INITVAL)?;
                self.set_child(pending_gt, INITVAL)?;
                return Some(());
            }
        }
    }

    /// Appends the matches at `in_base + cur_pos` to `matches`, each longer than the one before.
    #[inline(always)]
    pub(crate) fn get_matches(
        &mut self,
        input: &[u8],
        in_base: usize,
        cur_pos: usize,
        max_len: u32,
        nice_len: u32,
        max_search_depth: u32,
        next_hashes: &mut [u32; 2],
        matches: &mut Vec<LzMatch>,
    ) -> Option<()> {
        self.advance_one_byte(
            input,
            in_base,
            cur_pos,
            max_len,
            nice_len,
            max_search_depth,
            next_hashes,
            Some(matches),
        )
    }

    #[inline(always)]
    pub(crate) fn skip_byte(
        &mut self,
        input: &[u8],
        in_base: usize,
        cur_pos: usize,
        nice_len: u32,
        max_search_depth: u32,
        next_hashes: &mut [u32; 2],
    ) -> Option<()> {
        self.advance_one_byte(
            input,
            in_base,
            cur_pos,
            nice_len,
            nice_len,
            max_search_depth,
            next_hashes,
            None,
        )
    }
}
