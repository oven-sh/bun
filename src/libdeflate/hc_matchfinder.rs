//! Hash chains matchfinder, for the greedy and lazy levels: positions whose first four bytes hash alike form a list, newest first.

use crate::matchfinder::{
    INITVAL, Pos, WINDOW_SIZE, load_u24, load_u32, lz_extend, lz_hash, new_table, node_pos, rebase,
};

const HASH3_ORDER: u32 = 15;
const HASH4_ORDER: u32 = 16;

pub(crate) struct HcMatchfinder {
    hash3_tab: Box<[Pos; 1 << HASH3_ORDER]>,
    hash4_tab: Box<[Pos; 1 << HASH4_ORDER]>,
    /// The node after the one at position `pos` is `next_tab[pos]`.
    next_tab: Box<[Pos; WINDOW_SIZE]>,
    /// Nothing has been entered since the hash tables were filled.
    is_clear: bool,
}

impl HcMatchfinder {
    pub(crate) fn new() -> Option<Self> {
        Some(Self {
            hash3_tab: new_table()?,
            hash4_tab: new_table()?,
            next_tab: new_table()?,
            is_clear: true,
        })
    }

    pub(crate) fn init(&mut self) {
        if !core::mem::replace(&mut self.is_clear, false) {
            self.hash3_tab.fill(INITVAL);
            self.hash4_tab.fill(INITVAL);
        }
    }

    #[inline(never)]
    fn slide_window(&mut self) {
        rebase(self.hash3_tab.as_mut_slice());
        rebase(self.hash4_tab.as_mut_slice());
        rebase(self.next_tab.as_mut_slice());
    }

    #[inline(always)]
    fn next_node(&self, node: i32) -> Option<i32> {
        Some(i32::from(
            *self.next_tab.get(node as usize & (WINDOW_SIZE - 1))?,
        ))
    }

    /// The longest match at `in_next` over `best_len` bytes as (length, offset), or `best_len`. Moves `next_hashes` on to the next position.
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn longest_match(
        &mut self,
        input: &[u8],
        in_base: &mut usize,
        in_next: usize,
        mut best_len: u32,
        max_len: u32,
        nice_len: u32,
        max_search_depth: u32,
        next_hashes: &mut [u32; 2],
    ) -> Option<(u32, u32)> {
        let mut depth_remaining = max_search_depth;
        let mut best_match_pos = in_next;

        let mut cur_pos = in_next - *in_base;
        if cur_pos == WINDOW_SIZE {
            self.slide_window();
            *in_base += WINDOW_SIZE;
            cur_pos = 0;
        }
        let in_base = *in_base;
        let cutoff = cur_pos as i32 - WINDOW_SIZE as i32;

        'out: {
            // Four bytes are read at the next position.
            if max_len < 5 {
                break 'out;
            }

            let [hash3, hash4] = *next_hashes;
            let slot3 = self.hash3_tab.get_mut(hash3 as usize)?;
            let cur_node3 = i32::from(core::mem::replace(slot3, cur_pos as Pos));
            let slot4 = self.hash4_tab.get_mut(hash4 as usize)?;
            let mut cur_node4 = i32::from(core::mem::replace(slot4, cur_pos as Pos));
            *self.next_tab.get_mut(cur_pos)? = cur_node4 as Pos;

            let next_hashseq = load_u32(input, in_next + 1)?;
            *next_hashes = [
                lz_hash(next_hashseq & 0xFF_FFFF, HASH3_ORDER),
                lz_hash(next_hashseq, HASH4_ORDER),
            ];

            let seq4 = load_u32(input, in_next)?;

            if best_len < 4 {
                if cur_node3 <= cutoff {
                    break 'out;
                }
                if best_len < 3 {
                    let match_pos = node_pos(in_base, cur_node3);
                    if load_u24(input, match_pos)? == seq4 & 0xFF_FFFF {
                        best_len = 3;
                        best_match_pos = match_pos;
                    }
                }

                if cur_node4 <= cutoff {
                    break 'out;
                }
                let mut match_pos;
                loop {
                    match_pos = node_pos(in_base, cur_node4);
                    if load_u32(input, match_pos)? == seq4 {
                        break;
                    }
                    cur_node4 = self.next_node(cur_node4)?;
                    depth_remaining -= 1;
                    if cur_node4 <= cutoff || depth_remaining == 0 {
                        break 'out;
                    }
                }

                best_match_pos = match_pos;
                best_len = lz_extend(input, in_next, match_pos, 4, max_len)?;
                if best_len >= nice_len {
                    break 'out;
                }
                cur_node4 = self.next_node(cur_node4)?;
                depth_remaining -= 1;
                if cur_node4 <= cutoff || depth_remaining == 0 {
                    break 'out;
                }
            } else if cur_node4 <= cutoff || best_len >= nice_len {
                break 'out;
            }

            // Only a longer match is of use now, so look first at the bytes that would make it longer.
            loop {
                let mut match_pos;
                loop {
                    match_pos = node_pos(in_base, cur_node4);
                    let tail = best_len as usize - 3;
                    if load_u32(input, match_pos + tail)? == load_u32(input, in_next + tail)?
                        && load_u32(input, match_pos)? == seq4
                    {
                        break;
                    }
                    cur_node4 = self.next_node(cur_node4)?;
                    depth_remaining -= 1;
                    if cur_node4 <= cutoff || depth_remaining == 0 {
                        break 'out;
                    }
                }

                let len = lz_extend(input, in_next, match_pos, 4, max_len)?;
                if len > best_len {
                    best_len = len;
                    best_match_pos = match_pos;
                    if best_len >= nice_len {
                        break 'out;
                    }
                }
                cur_node4 = self.next_node(cur_node4)?;
                depth_remaining -= 1;
                if cur_node4 <= cutoff || depth_remaining == 0 {
                    break 'out;
                }
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
        next_hashes: &mut [u32; 2],
    ) -> Option<()> {
        if count as usize + 5 > input.len() - in_next {
            return Some(());
        }

        let mut cur_pos = in_next - *in_base;
        let [mut hash3, mut hash4] = *next_hashes;
        for _ in 0..count {
            if cur_pos == WINDOW_SIZE {
                self.slide_window();
                *in_base += WINDOW_SIZE;
                cur_pos = 0;
            }
            *self.hash3_tab.get_mut(hash3 as usize)? = cur_pos as Pos;
            let slot4 = self.hash4_tab.get_mut(hash4 as usize)?;
            *self.next_tab.get_mut(cur_pos)? = core::mem::replace(slot4, cur_pos as Pos);

            in_next += 1;
            let next_hashseq = load_u32(input, in_next)?;
            hash3 = lz_hash(next_hashseq & 0xFF_FFFF, HASH3_ORDER);
            hash4 = lz_hash(next_hashseq, HASH4_ORDER);
            cur_pos += 1;
        }
        *next_hashes = [hash3, hash4];
        Some(())
    }
}
