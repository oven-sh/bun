use core::hint::{Locality, prefetch_read, select_unpredictable};

use bun_highway::brotli::LENGTH_SHIFT;

use super::slots::{Linked, Slots};
use super::{Search, is_within};
use crate::dictionary::MIN_WORD_LENGTH;
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::{bytes_at, hash_of_four, load32, load64, match_length};
use crate::encoder::ring_buffer::{SLACK, Window};
use crate::encoder::symbol_set::{GROUP, group_where};
use crate::encoder::words::{MAX_MATCH_LENGTH, WordMatches};
use crate::format::WINDOW_GAP;
use crate::memory::{self, Result};

const KEY_BITS: u32 = 17;
const MAX_DEPTH: usize = 64;
const NONE: u32 = u32::MAX;

/// From the low bits: the distance (32 bits), the length of the word of the static dictionary, if it is one, and the length.
#[derive(Clone, Copy, Default)]
pub(in crate::encoder) struct Candidate(pub(in crate::encoder) u64);

impl Candidate {
    #[inline(always)]
    pub(in crate::encoder) fn new(distance: usize, length: usize) -> Self {
        Self::word(distance, length, 0)
    }

    #[inline(always)]
    fn word(distance: usize, length: usize, word_length: usize) -> Self {
        Self(((length << LENGTH_SHIFT) | (word_length << 32) | distance) as u64)
    }

    #[inline(always)]
    pub(in crate::encoder) fn distance(self) -> usize {
        self.0 as u32 as usize
    }

    #[inline(always)]
    pub(in crate::encoder) fn length(self) -> usize {
        (self.0 >> LENGTH_SHIFT) as usize
    }

    #[inline(always)]
    pub(in crate::encoder) fn word_length(self) -> Option<usize> {
        let without_length = self.0 % (1 << LENGTH_SHIFT);
        Some((without_length >> 32) as usize).filter(|&length| length != 0)
    }
}

/// For those at one position.
pub(in crate::encoder) type Candidates = [Candidate; 128];

#[inline(always)]
fn key(data: &[u8], at: usize) -> usize {
    hash_of_four(load32(data, at), KEY_BITS)
}

enum Roots {
    Dense(Box<[u32; 1 << KEY_BITS]>),
    /// Holds the positions plus one.
    Few(Linked),
}

impl Roots {
    #[inline(always)]
    fn find(&mut self, key: usize, new_root: Option<usize>) -> usize {
        let root = match self {
            Self::Dense(roots) => {
                let root = roots[key];
                roots[key] = new_root.map_or(root, |position| position as u32);
                root
            }
            Self::Few(roots) => Self::find_among_few(roots, key, new_root),
        };
        root as usize
    }

    #[cold]
    fn find_among_few(roots: &mut Linked, key: usize, new_root: Option<usize>) -> u32 {
        let root = roots.get(key).wrapping_sub(1);
        if let Some(position) = new_root {
            roots.set(key, position + 1);
        }
        root
    }
}

/// For each hash, a tree of positions, sorted by what follows them, with the latest at the root (qualities 10 and 11).
pub(in crate::encoder) struct BinaryTree {
    roots: Roots,
    /// The left and the right child of each position in the window.
    children: Vec<u32>,
    window_mask: usize,
}

impl BinaryTree {
    /// How many bytes decide the order.
    pub(in crate::encoder) const LOOKAHEAD: usize = 128;
    /// The most that [`find_all`](Self::find_all) finds. Two are from nearby, and there are only words after short matches.
    pub(in crate::encoder) const MAX_CANDIDATES: usize = 2 + MAX_DEPTH;

    pub(in crate::encoder) fn new(window_bits: u32, small_size: Option<usize>) -> Result<Self> {
        Ok(Self {
            roots: match small_size {
                Some(size) => Roots::Few(Linked::new(size + 1)?),
                None => Roots::Dense(memory::filled_array(NONE)?),
            },
            children: Vec::new(),
            window_mask: (1 << window_bits) - 1,
        })
    }

    pub(in crate::encoder) fn clear(&mut self) {
        if let Roots::Dense(roots) = &mut self.roots {
            roots.fill(NONE);
        }
    }

    pub(in crate::encoder) fn begin_block(&mut self, block: &InputBlock<'_>) -> Result<()> {
        let (window, position, length) = (block.window, block.position, block.length);
        let most = 2 * (self.window_mask + 1);
        let needed = most.min(2 * block.end());
        let capacity = if block.may_be_all() { needed } else { most };
        memory::try_reserve_total(&mut self.children, capacity)?;
        memory::resize(&mut self.children, needed, NONE);
        if length >= 3 && position >= Self::LOOKAHEAD {
            let start = position - Self::LOOKAHEAD + 1;
            for earlier in start..position.min(start + length) {
                let max_backward = self.window_mask - (WINDOW_GAP - 1).max(position - earlier);
                self.store(window, earlier, max_backward);
            }
        }
        Ok(())
    }

    pub(in crate::encoder) fn store_range(&mut self, window: Window<'_>, start: usize, end: usize) {
        let max_backward = self.window_mask + 1 - WINDOW_GAP;
        let dense_start = start.max(end.saturating_sub(63));
        if start + 512 <= dense_start {
            for position in (start..dense_start).step_by(8) {
                self.store(window, position, max_backward);
            }
        }
        for position in dense_start..end {
            self.store(window, position, max_backward);
        }
    }

    #[inline(never)]
    fn store(&mut self, window: Window<'_>, position: usize, max_backward: usize) {
        let padded = &window.from(position)[..Self::LOOKAHEAD + SLACK];
        self.walk::<true>(window, position, padded, max_backward, None);
    }

    /// Reports the matches on the way down. `STORE`, for [`LOOKAHEAD`](Self::LOOKAHEAD) bytes or more, makes `position` the root.
    #[inline(always)]
    fn walk<const STORE: bool>(
        &mut self,
        window: Window<'_>,
        position: usize,
        padded: &[u8],
        max_backward: usize,
        mut longer: Option<&mut Longer<'_>>,
    ) {
        const PER_CHILD: usize = BinaryTree::LOOKAHEAD;
        let compared = if STORE {
            PER_CHILD
        } else {
            padded.len() - SLACK
        };
        debug_assert!(STORE || compared < PER_CHILD);
        let data = &padded[..compared + SLACK];
        let mut earlier = self.roots.find(key(data, 0), STORE.then_some(position));
        let (children, window_mask) = (&mut *self.children, self.window_mask);
        // Where in `children` the next smaller and larger positions go, and below that the length of the match with the previous ones.
        let mut left = 2 * PER_CHILD * (position & window_mask);
        let mut right = left + PER_CHILD;
        let (mut known, mut depth) = (0, 0);
        let same = 'walk: loop {
            if !is_within(max_backward, position, earlier) || depth == MAX_DEPTH {
                break None;
            }
            let node = earlier & window_mask;
            let below: [u32; 2] = children.as_chunks().0[node];
            let at = window.index(earlier);
            let other = &window.bytes[at..at + data.len()];
            let (mut ours, mut theirs) = (load64(data, known), load64(other, known));
            if ours == theirs {
                loop {
                    known += 8;
                    if known >= compared {
                        break 'walk Some(below);
                    }
                    (ours, theirs) = (load64(data, known), load64(other, known));
                    if ours != theirs {
                        break;
                    }
                }
            }
            let length = known + ((ours ^ theirs).trailing_zeros() / 8) as usize;
            if length >= compared {
                break Some(below);
            }
            depth += 1;
            if let Some(longer) = &mut longer {
                longer.add(position - earlier, length);
            }

            let here = 2 * PER_CHILD * node + length;
            let go_right = ours.swap_bytes() > theirs.swap_bytes();
            let filled = select_unpredictable(go_right, left, right);
            let open = select_unpredictable(go_right, right, left);
            let next = select_unpredictable(go_right, below[1], below[0]);
            left = select_unpredictable(go_right, here + PER_CHILD, left);
            right = select_unpredictable(go_right, right, here);
            known = length.min(open % PER_CHILD);
            if STORE {
                children[filled / PER_CHILD] = earlier as u32;
            }
            earlier = next as usize;
        };
        if STORE {
            let [left_child, right_child] = same.unwrap_or([NONE; 2]);
            children[left / PER_CHILD] = left_child;
            children[right / PER_CHILD] = right_child;
        }
        if let Some(longer) = longer
            && same.is_some()
        {
            let rest = &padded[compared..padded.len() - SLACK];
            let more = match_length(&window.from(earlier)[compared..], rest);
            longer.add(position - earlier, compared + more);
        }
    }

    #[inline(always)]
    fn prefetch(&self, window: Window<'_>, padded: &[u8]) {
        if let Some(ahead) = padded.get(4..16)
            && let Roots::Dense(roots) = &self.roots
        {
            prefetch_read(&raw const roots[key(ahead, 8)], Locality::L1);
            let root = roots[key(ahead, 0)] as usize;
            let node = 2 * (root & self.window_mask);
            prefetch_read(self.children.as_ptr().wrapping_add(node), Locality::L1);
            let bytes = window.bytes.as_ptr().wrapping_add(window.index(root));
            prefetch_read(bytes, Locality::L1);
        }
    }

    /// Returns how many matches of increasing length `found` begins with now, and stores the position.
    #[inline(always)]
    pub(in crate::encoder) fn find_all(
        &mut self,
        search: &Search<'_>,
        short_match_range: usize,
        words: &mut WordMatches,
        found: &mut Candidates,
    ) -> usize {
        let &Search {
            window,
            position,
            padded,
            max_backward,
            ..
        } = search;
        self.prefetch(window, padded);
        let mut longer = Longer {
            than: 1,
            count: 0,
            found,
        };
        find_nearby(search, short_match_range, &mut longer);
        let data = search.data();
        if data.len() >= Self::LOOKAHEAD.max(longer.than + 1) {
            self.walk::<true>(window, position, padded, max_backward, Some(&mut longer));
        } else if data.len() > longer.than {
            self.walk::<false>(window, position, padded, max_backward, Some(&mut longer));
        }

        let min_length = (longer.than + 1).max(MIN_WORD_LENGTH);
        let mut count = longer.count;
        if min_length > MAX_MATCH_LENGTH.min(data.len()) {
            return count;
        }
        words.find(padded, min_length);
        for (address, length, word_length) in words.from_length(min_length) {
            let distance = search.block.max_copy_distance(position) + 1 + address;
            if distance <= search.block.params.distance.max_distance {
                found[count] = Candidate::word(distance, length, word_length);
                count += 1;
            }
        }
        count
    }
}

struct Longer<'a> {
    than: usize,
    count: usize,
    found: &'a mut Candidates,
}

impl Longer<'_> {
    #[inline(always)]
    fn add(&mut self, distance: usize, length: usize) {
        self.found[self.count % self.found.len()] = Candidate::new(distance, length);
        self.count += usize::from(length > self.than);
        self.than = self.than.max(length);
    }
}

/// Matches of two and three bytes, which have no hash, at distances below `range`.
#[inline(always)]
fn find_nearby(search: &Search<'_>, range: usize, longer: &mut Longer<'_>) {
    let [first, second] = bytes_at(search.padded, 0);
    let end = range.min(search.position);
    for nearest in (1..end).step_by(GROUP) {
        let farthest = nearest + GROUP - 1;
        let start = search.window.index(search.position.wrapping_sub(farthest));
        let bytes = search.window.bytes.get(start..start + GROUP + 1);
        let mut pairs = bytes.map_or(u16::MAX, |bytes| {
            group_where(GROUP, |i| (bytes[i] == first) & (bytes[i + 1] == second)) as u16
        });
        while pairs != 0 {
            let distance = nearest + pairs.leading_zeros() as usize;
            if distance >= end {
                return;
            }
            pairs ^= 1 << (farthest - distance);
            let earlier = search.window.index(search.position - distance);
            longer.add(distance, search.match_length_at(earlier));
            if longer.than > 2 {
                return;
            }
        }
    }
}
