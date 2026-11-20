//! A [tree](super::tree) into which positions are only sorted once a search comes across them.

use core::hint::cold_path;

use super::hash::Hasher;
use super::lazy::{Finder, Match};
use super::tree::{self, Descent, Node, Tree};
use super::{Attached, MatchState, Reach, WORD};
use crate::bytes::{self, highest_bit, likely, u64_at};
use crate::sequences::OffsetValue;
use crate::window::{History, WORD_LEN};

/// In the second half of a node. The first half links to the last position with the same hash.
pub(super) const UNSORTED: u32 = 1;

pub(super) struct LazyTree<'a> {
    tree: Tree<'a>,
    attached: Attached<'a>,
    attached_hasher: Hasher,
    window_len: u32,
}

impl<'a> LazyTree<'a> {
    pub(super) fn new(state: &'a mut MatchState, attached: &Attached<'a>) -> Self {
        let min_match = state.tuning.min_match.clamp(4, 6);
        Self {
            attached: *attached,
            attached_hasher: Hasher::new(min_match, attached.tuning.hash_log),
            window_len: 1 << state.tuning.window_log,
            tree: Tree::new(state, min_match),
        }
    }

    /// Out of line, where its loop has the registers for itself.
    #[inline(never)]
    fn link_up_to(&mut self, history: History<'_>, end: u32) -> Option<()> {
        let tree = &mut self.tree;
        let (nodes, hasher, roots) = (tree.nodes.checked()?, tree.hasher, &mut *tree.roots);
        let bytes = likely(history.prefix.get(..end as usize + WORD_LEN))?;
        for position in history.position(tree.next_to_index) as usize..end as usize {
            let word = bytes.get(position..position + WORD_LEN)?.as_array()?;
            let root = likely(roots.get_mut(hasher.hash(u64::from_le_bytes(*word))))?;
            let index = history.index(position as u32);
            let [link, mark] = nodes.get(index)?;
            link.set(core::mem::replace(root, index));
            mark.set(UNSORTED);
        }
        tree.next_to_index = history.index(end);
        Some(())
    }

    #[inline(never)]
    fn sort<const REACH: Reach>(
        &self,
        history: History<'_>,
        current: u32,
        attempts: u32,
        last: u32,
    ) -> Option<()> {
        let history = &history.with_prefix_of::<WORD_LEN>()?;
        let nodes = self.tree.nodes.checked()?;
        let (run, at) = match REACH {
            Reach::Older => history.locate(current),
            _ => (history.prefix, history.position(current)),
        };
        let lowest = self.tree.bounds.older_start;
        let lowest = lowest.max(current.saturating_sub(self.window_len));
        let spare = Node::default();
        let node @ [link, _] = nodes.get(current)?;
        let mut index = link.get();
        let mut descent = Descent::new(node, at);

        let last = last.max(lowest);
        for _ in (0..attempts).rev() {
            let node = if index > last {
                nodes.get(index)?
            } else {
                cold_path();
                if index <= lowest {
                    break;
                }
                &spare
            };
            let known = descent.known;
            let (end, is_smaller) = if REACH == Reach::Older && current < history.prefix_index {
                let earlier = history.older_position(index) + (known - at);
                let from = |at: u32| run.get(at as usize..);
                let (len, is_smaller) = bytes::compare(from(known)?, from(earlier)?);
                (known + len as u32, is_smaller)
            } else {
                tree::compare::<REACH>(history, at, index, known)
            };
            if end as usize == run.len() {
                break;
            }
            index = descent.step(index, node, end, is_smaller);
        }
        descent.finish();
        Some(())
    }

    /// Those that `index` links to, starting with the oldest one.
    #[inline(always)]
    fn sort_chain<const REACH: Reach>(
        &self,
        history: &History<'_>,
        mut index: u32,
        last: u32,
    ) -> Option<()> {
        let nodes = self.tree.nodes.checked()?;
        let mut attempts = self.tree.attempts;
        let mut newer = 0;
        while index > last {
            let [link, mark] = nodes.get(index)?;
            if mark.get() != UNSORTED {
                break;
            }
            if attempts <= 1 {
                link.set(0);
                mark.set(0);
                break;
            }
            // The chain is reversed, to find the way back.
            mark.set(newer);
            (newer, index) = (index, link.get());
            attempts -= 1;
        }
        while newer != 0 {
            let [_, mark] = nodes.get(newer)?;
            let next = mark.get();
            self.sort::<REACH>(*history, newer, attempts, last)?;
            newer = next;
            attempts += 1;
        }
        Some(())
    }
}

impl Finder for LazyTree<'_> {
    const MARGIN: u32 = WORD;
    const GAINS_FROM_BMI2: bool = false;
    type Scratch = ();

    #[inline(always)]
    fn catch_up(&mut self, history: &History<'_>, (): &mut (), at: u32, _: bool) -> Option<()> {
        if self.tree.next_to_index < history.index(at) {
            self.link_up_to(*history, at)?;
        }
        Some(())
    }

    #[inline(always)]
    fn find<const REACH: Reach>(
        &mut self,
        history: &History<'_>,
        (): &mut (),
        at: u32,
        _: bool,
    ) -> Option<Match> {
        let current = history.index(at);
        let mut best = Match {
            len: 0,
            ..Match::NONE
        };
        if current < self.tree.next_to_index {
            return Some(best);
        }

        let word = likely(u64_at(history.prefix, at))?;
        let lowest = self.tree.bounds.lowest(current);
        let nodes = self.tree.nodes.checked()?;
        self.tree.prefetch_after(history, nodes, at);
        let overwritten = nodes.overwritten(current);
        let root = likely(self.tree.roots.get_mut(self.tree.hasher.hash(word)))?;
        let mut index = core::mem::replace(root, current);
        self.sort_chain::<REACH>(history, index, overwritten.max(lowest))?;

        let spare = Node::default();
        let mut descent = Descent::new(nodes.get(current)?, at);
        let mut matched_end = current + WORD + 1;
        let mut attempts = self.tree.attempts;
        while attempts > 0 && index > lowest {
            let node = nodes.get(index)?;
            let (end, is_smaller) = tree::compare::<REACH>(history, at, index, descent.known);
            let len = end - at;
            if len > best.len {
                matched_end = matched_end.max(index + len);
                let extra_bits =
                    highest_bit(current - index + 1) as i32 - best.offset.code() as i32;
                if 4 * (len - best.len) as i32 > extra_bits {
                    let offset = OffsetValue::new(current - index);
                    best = Match { len, offset };
                }
                if end == history.end() {
                    attempts = 0;
                    break;
                }
            }
            if index <= overwritten {
                descent.step(index, &spare, end, is_smaller);
                break;
            }
            index = descent.step(index, node, end, is_smaller);
            attempts -= 1;
        }
        descent.finish();

        if REACH == Reach::Attached {
            let root = *self.attached.hash.get(self.attached_hasher.hash(word))?;
            tree::descend_attached(&self.attached, history, at, root, attempts, |index, len| {
                if len <= best.len {
                    return false;
                }
                let extra_bits =
                    highest_bit(current - index + 1) as i32 - highest_bit(best.offset.0 + 1) as i32;
                if 4 * (len - best.len) as i32 > extra_bits {
                    let offset = OffsetValue::new(current - index);
                    best = Match { len, offset };
                }
                at + len == history.end()
            })?;
        }
        self.tree.next_to_index = matched_end - WORD;
        Some(best)
    }

    fn finish(self, _: &History<'_>) -> u32 {
        self.tree.next_to_index
    }
}
