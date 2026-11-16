//! Finds matches of 4 bytes or more at the last two nodes with the same hash.

use crate::hash_lists::HashLists;
use crate::window::{Bytes, match_len, oldest_for, reach, u32_at};

pub(crate) type HashTable<'a> = HashLists<'a, 4, { 1 << 15 }>;

impl HashTable<'_> {
    /// Returns the length, or 0, and the offset.
    #[inline(always)]
    pub(crate) fn longest_match(
        &self,
        window: &Bytes,
        node: usize,
        max_len: usize,
        nice_len: usize,
    ) -> (usize, usize) {
        let near = self.next(node);
        let far = self.next(near);
        let (here, near_bytes, far_bytes) =
            (reach(window, node), reach(window, near), reach(window, far));
        let prefix = u32_at(here, 0);
        let (near_matches, far_matches) = (
            u32_at(near_bytes, 0) == prefix,
            u32_at(far_bytes, 0) == prefix,
        );
        if !(near_matches | far_matches) {
            return (0, 0);
        }
        let oldest = oldest_for(node);
        if near_matches {
            if near < oldest {
                return (0, 0);
            }
            let len = match_len(here, near_bytes, 4, max_len);
            // The last nodes of the input lead nowhere, so here `max_len` is more than 4.
            let last = usize::from((len - 3) as u8);
            if far_matches
                && u32_at(far_bytes, last) == u32_at(here, last)
                && len < nice_len
                && far >= oldest
            {
                let far_len = match_len(here, far_bytes, 4, max_len);
                if far_len > len {
                    return (far_len, node - far);
                }
            }
            return (len, node - near);
        }
        if far < oldest {
            return (0, 0);
        }
        (match_len(here, far_bytes, 4, max_len), node - far)
    }
}
