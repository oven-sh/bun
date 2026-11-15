use core::hint::{Locality, prefetch_read, select_unpredictable};

use super::Search;
use crate::dictionary::MIN_WORD_LENGTH;
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::{bytes_at, hash_of_four, load32, load64};
use crate::encoder::ring_buffer::{SLACK, Window};
use crate::encoder::words::{MAX_MATCH_LENGTH, WordMatches};
use crate::format::WINDOW_GAP;
use crate::memory::{self, Result};

const KEY_BITS: u32 = 17;
const MAX_DEPTH: usize = 64;
const NONE: u32 = u32::MAX;

#[derive(Clone, Copy)]
pub(in crate::encoder) struct Candidate {
    distance: u32,
    /// The length of the word of the static dictionary in the low 5 bits, unless it is the same.
    lengths: u32,
}

impl Candidate {
    #[inline(always)]
    pub(in crate::encoder) fn new(distance: usize, length: usize) -> Self {
        Self {
            distance: distance as u32,
            lengths: (length << 5) as u32,
        }
    }

    fn word(distance: usize, length: usize, word_length: usize) -> Self {
        Self {
            distance: distance as u32,
            lengths: ((length << 5) | word_length) as u32,
        }
    }

    #[inline(always)]
    pub(in crate::encoder) fn distance(self) -> usize {
        self.distance as usize
    }

    #[inline(always)]
    pub(in crate::encoder) fn length(self) -> usize {
        (self.lengths >> 5) as usize
    }

    #[inline(always)]
    pub(in crate::encoder) fn word_length(self) -> Option<usize> {
        Some((self.lengths % 32) as usize).filter(|&length| length != 0)
    }
}

#[inline(always)]
fn key(data: &[u8], at: usize) -> usize {
    hash_of_four(load32(data, at), KEY_BITS)
}

/// For each hash, a tree of positions, sorted by what follows them, with the latest at the root (qualities 10 and 11).
pub(in crate::encoder) struct BinaryTree {
    roots: Box<[u32; 1 << KEY_BITS]>,
    /// The left and the right child of each position in the window.
    children: Vec<u32>,
    window_mask: usize,
    words: WordMatches,
}

impl BinaryTree {
    /// How many bytes decide the order.
    pub(in crate::encoder) const LOOKAHEAD: usize = 128;
    /// The most that [`find_all`](Self::find_all) adds.
    pub(in crate::encoder) const MAX_CANDIDATES: usize = 128;

    pub(in crate::encoder) fn new(window_bits: u32) -> Result<Self> {
        Ok(Self {
            roots: memory::filled_array(NONE)?,
            children: Vec::new(),
            window_mask: (1 << window_bits) - 1,
            words: WordMatches::new(),
        })
    }

    pub(in crate::encoder) fn clear(&mut self) {
        self.roots.fill(NONE);
    }

    pub(in crate::encoder) fn begin_block(&mut self, block: &InputBlock<'_>) -> Result<()> {
        let (window, position, length) = (block.window, block.position, block.length);
        let most = 2 * (self.window_mask + 1);
        let needed = most.min(2 * block.end());
        let capacity = if block.may_be_all() { needed } else { most };
        memory::try_reserve_total(&mut self.children, capacity)?;
        self.children.resize(needed, NONE);
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

    /// Reports the matches on the way down. With `STORE`, makes `position` the root.
    #[inline(always)]
    fn walk<const STORE: bool>(
        &mut self,
        window: Window<'_>,
        position: usize,
        padded: &[u8],
        max_backward: usize,
        mut longer: Option<&mut Longer<'_>>,
    ) {
        let root = &mut self.roots[key(padded, 0)];
        let mut earlier = *root as usize;
        if STORE {
            *root = position as u32;
        }
        let max_length = padded.len() - SLACK;
        let compared = max_length.min(Self::LOOKAHEAD);
        let left_of = |position: usize| 2 * (position & self.window_mask);
        let children = &mut *self.children;
        let (mut left, mut right) = (left_of(position), left_of(position) + 1);
        let (mut left_length, mut right_length) = (0, 0);
        for _ in 0..MAX_DEPTH {
            let distance = position.wrapping_sub(earlier);
            if distance.wrapping_sub(1) >= max_backward {
                break;
            }
            let node = left_of(earlier);
            let below = &children[node..node + 2];
            let (left_child, right_child) = (below[0], below[1]);

            let other = window.from(earlier);
            let mut length = left_length.min(right_length);
            let (ours, theirs) = loop {
                let (ours, theirs) = (load64(padded, length), load64(other, length));
                if ours != theirs || length + 8 >= max_length {
                    break (ours, theirs);
                }
                length += 8;
            };
            length += ((ours ^ theirs).trailing_zeros() / 8) as usize;
            length = length.min(max_length);
            if let Some(longer) = &mut longer {
                longer.add(distance, length);
            }
            if length >= compared {
                if STORE {
                    children[left] = left_child;
                    children[right] = right_child;
                }
                return;
            }

            let go_right = ours.swap_bytes() > theirs.swap_bytes();
            if STORE {
                children[select_unpredictable(go_right, left, right)] = earlier as u32;
            }
            (left, left_length) =
                select_unpredictable(go_right, (node + 1, length), (left, left_length));
            (right, right_length) =
                select_unpredictable(go_right, (right, right_length), (node, length));
            earlier = select_unpredictable(go_right, right_child, left_child) as usize;
        }
        if STORE {
            children[left] = NONE;
            children[right] = NONE;
        }
    }

    #[inline(always)]
    fn prefetch(&self, window: Window<'_>, padded: &[u8]) {
        if let Some(ahead) = padded.get(4..16) {
            prefetch_read(&raw const self.roots[key(ahead, 8)], Locality::L1);
            let root = self.roots[key(ahead, 0)] as usize;
            let node = 2 * (root & self.window_mask);
            prefetch_read(self.children.as_ptr().wrapping_add(node), Locality::L1);
            let bytes = window.bytes.as_ptr().wrapping_add(window.index(root));
            prefetch_read(bytes, Locality::L1);
        }
    }

    /// Appends matches of increasing length to `found`, which has room for them, and stores the position.
    #[inline(always)]
    pub(in crate::encoder) fn find_all(
        &mut self,
        search: &Search<'_>,
        short_match_range: usize,
        found: &mut Vec<Candidate>,
    ) {
        let &Search {
            window,
            position,
            padded,
            max_backward,
            ..
        } = search;
        self.prefetch(window, padded);
        let mut longer = Longer { than: 1, found };
        find_nearby(search, short_match_range, &mut longer);
        let data = search.data();
        if data.len() >= Self::LOOKAHEAD.max(longer.than + 1) {
            self.walk::<true>(window, position, padded, max_backward, Some(&mut longer));
        } else if data.len() > longer.than {
            self.walk::<false>(window, position, padded, max_backward, Some(&mut longer));
        }

        let min_length = (longer.than + 1).max(MIN_WORD_LENGTH);
        if min_length > MAX_MATCH_LENGTH.min(data.len()) {
            return;
        }
        self.words.find(data, min_length);
        for (address, length, word_length) in self.words.from_length(min_length) {
            let distance = search.block.max_copy_distance(position) + 1 + address;
            if distance <= search.block.params.distance.max_distance {
                found.push(Candidate::word(distance, length, word_length));
            }
        }
    }
}

struct Longer<'a> {
    than: usize,
    found: &'a mut Vec<Candidate>,
}

impl Longer<'_> {
    #[inline(always)]
    fn add(&mut self, distance: usize, length: usize) {
        if length > self.than {
            self.than = length;
            self.found.push(Candidate::new(distance, length));
        }
    }
}

/// Matches of two and three bytes, which have no hash, at distances below `range`.
#[inline(always)]
fn find_nearby(search: &Search<'_>, range: usize, longer: &mut Longer<'_>) {
    const GROUP: usize = 16;
    let [first, second] = bytes_at(search.padded, 0);
    let end = range.min(search.position);
    for nearest in (1..end).step_by(GROUP) {
        let farthest = nearest + GROUP - 1;
        let start = search.window.index(search.position.wrapping_sub(farthest));
        let mut pairs = match search.window.bytes.get(start..start + GROUP + 1) {
            Some(bytes) => {
                let mut pairs = 0;
                for i in 0..GROUP {
                    pairs |= u16::from((bytes[i] == first) & (bytes[i + 1] == second)) << i;
                }
                pairs
            }
            None => u16::MAX,
        };
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
