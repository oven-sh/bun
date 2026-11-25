//! Finds matches of 3 bytes at the last node with the same 3-byte hash, and longer ones in a list per 4-byte hash.

use crate::hash_lists::{self, HashLists, RecentLinks};
use crate::window::{
    Bytes, GROUP, MatchFinder, Node, Reach, SLIDE, UNINDEXED, match_len, node_count, oldest_for,
    reach, slide_list, u32_at,
};
use crate::{Result, grow};
use core::cell::Cell;
use core::hint::select_unpredictable;
use core::ops::Range;

/// No parser takes a match of 3 bytes that is farther.
pub(crate) const MAX_OFFSET_OF_3: usize = 8192;

/// The next four nodes of a list, the first in the low bits, so that a search waits for one load instead of four.
type Shortcut = u64;

#[derive(Default)]
pub(crate) struct Storage {
    recent3: Vec<Node>,
    lists4: hash_lists::Storage,
    shortcuts: Vec<Shortcut>,
}

pub(crate) struct HashChains<'a> {
    recent3: RecentLinks<'a, 3, { 1 << 15 }>,
    lists4: HashLists<'a, 4, { 1 << 16 }>,
    /// The group after the last in `lists4`.
    groups_end: usize,
    shortcuts: &'a mut Vec<Shortcut>,
    node_count: usize,
    /// The first node without a shortcut.
    shortcuts_end: usize,
    takes_shortcuts: bool,
    /// About how many nodes searches have looked at lately, less what shortcuts cost by that measure.
    pub(crate) credit: usize,
}

impl<'a> HashChains<'a> {
    pub(crate) fn new(storage: &'a mut Storage, input_len: usize) -> Result<Self> {
        Ok(Self {
            recent3: RecentLinks::new(&mut storage.recent3)?,
            lists4: HashLists::new(&mut storage.lists4, input_len)?,
            groups_end: 0,
            shortcuts: &mut storage.shortcuts,
            node_count: node_count(input_len),
            shortcuts_end: 0,
            takes_shortcuts: false,
            credit: 0,
        })
    }

    /// Has to be called before searches from `node` on can find matches of 3 bytes.
    pub(crate) fn index_3_bytes(&mut self, window: &Bytes, node: usize) {
        let groups = node.saturating_sub(MAX_OFFSET_OF_3) / GROUP..self.groups_end;
        self.recent3.insert(window, groups);
    }

    /// Only if searches have been long. Returns whether those from `node` on are to take them.
    pub(crate) fn make_shortcuts(&mut self, node: usize) -> bool {
        // Starting to take them costs a whole window of them.
        let most = node.clamp(4096, 32768) / 4;
        self.takes_shortcuts = self.credit >= most || (self.takes_shortcuts && self.credit != 0);
        self.credit = self.credit.min(most);
        self.takes_shortcuts && self.extend_shortcuts(oldest_for(node)).is_ok()
    }

    #[inline(never)]
    fn extend_shortcuts(&mut self, oldest: usize) -> Result<()> {
        let shortcuts = grow(self.shortcuts, self.node_count)?;
        // Whatever is left before `oldest` only leads further back.
        let nodes = self.shortcuts_end.max(oldest)..self.groups_end * GROUP;
        let shortcuts = Cell::from_mut(shortcuts).as_slice_of_cells();
        let new = shortcuts.get(nodes.start..nodes.end).unwrap_or_default();
        let links = self.lists4.links().get(nodes.start..).unwrap_or_default();
        for (new, &next) in new.iter().zip(links) {
            let further = shortcuts.get(usize::from(next)).map_or(0, Cell::get);
            new.set((further << Node::BITS) | Shortcut::from(next));
        }
        self.shortcuts_end = nodes.end;
        Ok(())
    }

    /// Returns the length and the offset of a match longer than `best_len`, or else `best_len` and 0.
    #[inline(always)]
    pub(crate) fn longest_match<const TAKES_SHORTCUTS: bool>(
        &self,
        window: &Bytes,
        node: usize,
        best_len: usize,
        max_len: usize,
        nice_len: usize,
        max_depth: usize,
        visited: &mut usize,
    ) -> (usize, usize) {
        debug_assert!(nice_len <= max_len);
        let here = reach(window, node);
        let oldest = oldest_for(node);
        let last = usize::from(best_len.saturating_sub(3) as u8);
        let mut search = Search {
            window,
            here,
            prefix: u32_at(here, 0),
            oldest,
            max_len,
            nice_len,
            best_len,
            best: node,
            last,
            suffix: u32_at(here, last),
        };
        let mut depth = max_depth;
        if TAKES_SHORTCUTS {
            let shortcut = |node| self.shortcuts.get(node).copied().unwrap_or_default();
            let mut nodes = shortcut(node);
            loop {
                let nth = |index| usize::from((nodes >> (index * Node::BITS)) as Node);
                let next = shortcut(nth(3));
                if search.ends_at(nth(0), true)
                    || search.ends_at(nth(1), depth > 1)
                    || search.ends_at(nth(2), depth > 2)
                    || search.ends_at(nth(3), depth > 3)
                    || nth(3) < oldest
                    || depth <= 4
                {
                    // About as many as without shortcuts.
                    *visited += 2 * usize::from(nth(1) >= oldest);
                    break;
                }
                depth -= 4;
                nodes = next;
            }
        } else {
            let mut near = self.lists4.next(node);
            loop {
                let far = self.lists4.next(near);
                let next = self.lists4.next(far);
                if search.ends_at(near, true)
                    || search.ends_at(far, depth > 1)
                    || far < oldest
                    || depth <= 2
                {
                    break;
                }
                depth -= 2;
                near = next;
            }
        }
        *visited += max_depth - depth;
        if search.best_len < 3 {
            let candidate = self.recent3.before(node);
            // Whether what is too far matches would be one more thing to predict.
            let candidate = select_unpredictable(candidate < oldest, 0, candidate);
            if (u32_at(window, candidate) ^ search.prefix) << 8 == 0
                && candidate >= oldest
                && max_len > UNINDEXED
            {
                return (3, node - candidate);
            }
        }
        (search.best_len, node - search.best)
    }
}

struct Search<'a> {
    window: &'a Bytes,
    here: &'a Reach,
    prefix: u32,
    oldest: usize,
    max_len: usize,
    nice_len: usize,
    best_len: usize,
    best: usize,
    /// Where `suffix` is. It ends with the byte that would make a match longer than the best, the most likely to differ.
    last: usize,
    suffix: u32,
}

impl Search<'_> {
    #[inline(always)]
    fn ends_at(&mut self, candidate: usize, is_within_depth: bool) -> bool {
        if u32_at(self.window, candidate + self.last) != self.suffix {
            return false;
        }
        if candidate < self.oldest || !is_within_depth {
            return true;
        }
        let bytes = reach(self.window, candidate);
        if u32_at(bytes, 0) != self.prefix {
            return false;
        }
        let len = match_len(self.here, bytes, 4, self.max_len);
        if len <= self.best_len {
            return false;
        }
        (self.best_len, self.best) = (len, candidate);
        self.last = usize::from((len - 3) as u8);
        self.suffix = u32_at(self.here, self.last);
        len >= self.nice_len
    }
}

impl MatchFinder for HashChains<'_> {
    fn insert(&mut self, window: &Bytes, groups: Range<usize>) {
        self.groups_end = groups.end;
        // In a run of one byte, making a shortcut waits for the store of the one before.
        let cost = if self.lists4.is_in_run() { 16 } else { 4 };
        self.credit = self.credit.saturating_sub(cost * groups.len());
        self.lists4.insert(window, groups);
    }

    fn leave_out(&mut self, nodes: Range<usize>) {
        self.lists4.leave_out(nodes);
    }

    fn slide(&mut self) {
        self.recent3.slide();
        self.lists4.slide();
        self.shortcuts_end = self.shortcuts_end.saturating_sub(SLIDE);
        if self.shortcuts_end != 0 {
            let nodes = bun_pod::try_cast_slice_mut(self.shortcuts.as_mut_slice());
            slide_list::<4>(nodes.unwrap_or_default());
        }
    }
}
