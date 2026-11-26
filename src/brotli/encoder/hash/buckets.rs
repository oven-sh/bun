use core::hint::{Locality, prefetch_read, select_unpredictable};

use super::{Filter, Hasher, Match, RecentDistances, Search, Small, prefetch_for_store, score};
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::{HASH_MULTIPLIER_64, hash_of_four};
use crate::encoder::symbol_set::SymbolSet;
use crate::encoder::words::QuickWordSearch;
use crate::memory::{self, Result};

/// The top `bits` bits of a hash of five bytes if `LONG`, or else of four.
#[inline(always)]
fn hash<const LONG: bool>(eight: u64, bits: u32) -> usize {
    if LONG {
        (eight.wrapping_mul(HASH_MULTIPLIER_64 << 24) >> (64 - bits)) as usize
    } else {
        hash_of_four(eight as u32, bits)
    }
}

const BUCKET_BITS: u32 = 15;
const FIRST_CAPACITY: usize = 4;

/// The state of a bucket.
#[derive(Clone, Copy)]
struct Head(u64);

impl Head {
    const ROOM_SHIFT: u32 = 17;
    const NEXT_SHIFT: u32 = 32;

    #[inline(always)]
    fn new(count: usize, room: usize, next: usize) -> Self {
        Self(((next << Self::NEXT_SHIFT) | (room << Self::ROOM_SHIFT) | count) as u64)
    }

    /// How many positions it has seen, up to `1 << 16`, where it starts over.
    #[inline(always)]
    fn count(self) -> usize {
        self.0 as usize % (1 << Self::ROOM_SHIFT)
    }

    /// How many slots it has from `next` on.
    #[inline(always)]
    fn room(self) -> usize {
        (self.0 as u32 >> Self::ROOM_SHIFT) as usize
    }

    #[inline(always)]
    fn next(self) -> usize {
        (self.0 >> Self::NEXT_SHIFT) as usize
    }

    #[inline(always)]
    fn advanced(self) -> Self {
        Self(self.0 + (1 << Self::NEXT_SHIFT) + 1 - (1 << Self::ROOM_SHIFT))
    }
}

struct Table {
    heads: Box<[u64; 1 << BUCKET_BITS]>,
    /// A bucket moves to the end when it grows, so that a small input touches little memory.
    slots: Vec<u32>,
    /// How many of them belong to a bucket.
    used: usize,
    bucket_size: usize,
}

impl Table {
    /// Between [`FIRST_CAPACITY`] and `bucket_size`.
    fn second_capacity(&self) -> usize {
        (self.bucket_size / 8).max(16)
    }

    #[inline(never)]
    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        // With what a bucket leaves behind.
        let (first, second) = (FIRST_CAPACITY, self.second_capacity());
        let grown = first + second;
        let full = grown + self.bucket_size;
        let most = full << BUCKET_BITS;
        let needed = if block.may_be_all() {
            let for_each_position =
                (first.max(grown.div_ceil(first + 1))).max(full.div_ceil(second + 1));
            most.min(for_each_position * block.length)
        } else {
            most
        };
        memory::try_reserve_total(&mut self.slots, needed)
    }

    /// Returns the first of them.
    #[inline(always)]
    fn take_slots(&mut self, count: usize) -> usize {
        let first = self.used;
        self.used += count;
        if self.used > self.slots.len() {
            memory::grow(&mut self.slots, self.used);
        }
        first
    }

    /// Gives slots to a bucket that has none, without a branch on that.
    #[inline(always)]
    fn set_up(&mut self, head: Head) -> Head {
        let is_new = head.0 == 0;
        let first = self.take_slots(FIRST_CAPACITY * usize::from(is_new));
        select_unpredictable(is_new, Head::new(0, FIRST_CAPACITY, first), head)
    }

    #[inline(always)]
    fn insert(&mut self, key: usize, mut head: Head, position: usize) {
        if head.room() == 0 {
            head = if head.0 == 0 {
                self.set_up(head)
            } else {
                self.make_room(head)
            };
        }
        let slot = &mut self.slots[head.next()];
        prefetch_for_store(slot);
        *slot = position as u32;
        self.heads[key] = head.advanced().0;
    }

    #[inline(never)]
    fn make_room(&mut self, head: Head) -> Head {
        let count = head.count();
        if count >= self.bucket_size {
            let start = head.next() - self.bucket_size;
            return Head::new(count % (1 << 16), self.bucket_size, start);
        }
        let capacity = match count {
            FIRST_CAPACITY => self.second_capacity(),
            _ => self.bucket_size,
        };
        let first = self.take_slots(capacity);
        (self.slots).copy_within(head.next() - count..head.next(), first);
        Head::new(count, capacity - count, first + count)
    }
}

/// Keeps the last positions for each hash (qualities 7 to 9).
pub(in crate::encoder) struct Buckets<const LONG: bool> {
    table: Table,
    words: QuickWordSearch,
}

impl Buckets<false> {
    /// Reading a bucket is faster than following many links, which has to pay off before the input ends.
    #[inline(always)]
    pub(in crate::encoder) fn should_replace(
        small: &Small<{ 1 << BUCKET_BITS }>,
        position: usize,
        input_size: usize,
    ) -> bool {
        /// For each byte of input.
        const USUAL_HOPS: usize = 3;
        /// Take about as long as setting up buckets.
        const SPARE_HOPS: usize = 1 << 12;
        let counted = small.hops.min(USUAL_HOPS * (input_size - input_size / 4));
        counted.max(small.hops / 2) > USUAL_HOPS * position + SPARE_HOPS
    }

    /// Goes on at `position`, where `small` left off.
    pub(in crate::encoder) fn after(
        small: &Small<{ 1 << BUCKET_BITS }>,
        block: &InputBlock<'_>,
        position: usize,
    ) -> Result<Self> {
        let mut buckets = Self::new(small.max_hops.ilog2())?;
        buckets.words = small.words;
        buckets.try_reserve(block)?;
        small.store_all_in(&mut buckets, block.window, position);
        Ok(buckets)
    }
}

impl<const LONG: bool> Buckets<LONG> {
    pub(in crate::encoder) fn new(bucket_size_bits: u32) -> Result<Self> {
        Ok(Self {
            table: Table {
                heads: memory::zeroed_array()?,
                slots: Vec::new(),
                used: 0,
                bucket_size: 1 << bucket_size_bits,
            },
            words: QuickWordSearch::default(),
        })
    }
}

impl<const LONG: bool> Hasher for Buckets<LONG> {
    const LOOKAHEAD: usize = if LONG { 8 } else { 4 };

    #[inline(always)]
    fn recent_count(&self) -> usize {
        // Not from a field, so that the compiler leaves out the code for four.
        if self.table.bucket_size < 256 { 10 } else { 16 }
    }

    fn clear(&mut self) {
        self.table.heads.fill(0);
        self.table.used = 0;
    }

    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        self.table.try_reserve(block)
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        let key = hash::<LONG>(eight, BUCKET_BITS);
        self.table
            .insert(key, Head(self.table.heads[key]), position);
    }

    #[inline(always)]
    fn store_unmatched(&mut self, eight: u64, position: usize) {
        let key = hash::<LONG>(eight, BUCKET_BITS);
        let head = self.table.set_up(Head(self.table.heads[key]));
        self.table.insert(key, head, position);
    }

    #[inline(always)]
    fn prefetch(&self, eight: u64) {
        let next = Head(self.table.heads[hash::<LONG>(eight, BUCKET_BITS)]).next();
        for slot in [next, next.saturating_sub(16)] {
            prefetch_read(self.table.slots.as_ptr().wrapping_add(slot), Locality::L1);
        }
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, _: usize) -> Match {
        let key = hash::<LONG>(search.first_eight(), BUCKET_BITS);
        let recent_count = self.recent_count();
        let table = &mut self.table;
        let head = Head(table.heads[key]);
        let count = head.count() % (1 << 16);
        let (newer, older) = if count > table.bucket_size {
            (table.bucket_size - head.room(), head.room())
        } else {
            (count, 0)
        };
        let (newer, older) = table.slots[head.next() - newer..head.next() + older].split_at(newer);
        let mut best = Match::NONE;
        let length = search.try_recent(recent, recent_count, &mut best);
        let nearest = (newer.last()).map_or(0, |&at| search.position.wrapping_sub(at as usize));
        let length = search.raise(length, nearest, &self.words, &mut best);
        let mut filter = Filter::new(search, length);
        if length == search.data().len() && score(length, 1) <= best.score {
            filter.reject_all();
        }
        'bucket: for mut part in [newer, older] {
            if part.is_empty() {
                break;
            }
            while let [rest @ .., candidate] = filter.skip(search, part) {
                if !search.reaches_back_to(*candidate as usize) {
                    break 'bucket;
                }
                filter.try_passed(search, *candidate as usize, &mut best);
                part = rest;
            }
        }
        table.insert(key, head, search.position);
        search.try_words(&mut self.words, 2, &mut best);
        best
    }
}

/// A bit for each tag that equals `tag`.
#[inline(never)] // Inlined, it does not always become vector instructions.
fn equal_tags<const SIZE: usize>(tags: &[u8; SIZE], tag: u8) -> u64 {
    SymbolSet::matching(tags, |other| other == tag).words()[0]
}

/// Keeps 8 more bits of the hash with each position, to skip those that differ (qualities 5 and 6).
pub(in crate::encoder) struct TaggedBuckets<
    const LONG: bool,
    const BUCKETS: usize,
    const SIZE: usize,
> {
    /// How many positions each bucket has seen.
    counts: Box<[u16; BUCKETS]>,
    /// Filled from the end, so that older positions follow newer ones.
    positions: Box<[[u32; SIZE]; BUCKETS]>,
    tags: Box<[[u8; SIZE]; BUCKETS]>,
    words: QuickWordSearch,
}

impl<const SIZE: usize> TaggedBuckets<false, { 1 << 14 }, SIZE> {
    /// Goes on with `block`, before which `small` left off.
    pub(in crate::encoder) fn after(
        small: &Small<{ 1 << 14 }>,
        block: &InputBlock<'_>,
    ) -> Result<Self> {
        let mut buckets = Self::new()?;
        buckets.words = small.words;
        small.store_all_in(&mut buckets, block.window, block.position);
        Ok(buckets)
    }
}

impl<const LONG: bool, const BUCKETS: usize, const SIZE: usize> TaggedBuckets<LONG, BUCKETS, SIZE> {
    pub(in crate::encoder) fn new() -> Result<Self> {
        Ok(Self {
            counts: memory::zeroed_array()?,
            positions: memory::zeroed_array()?,
            tags: memory::zeroed_array()?,
            words: QuickWordSearch::default(),
        })
    }

    #[inline(always)]
    fn key_and_tag(eight: u64) -> (usize, u8) {
        let hash = hash::<LONG>(eight, BUCKETS.ilog2() + 8);
        ((hash >> 8) % BUCKETS, hash as u8)
    }

    #[inline(always)]
    fn insert(&mut self, key: usize, tag: u8, position: usize) {
        let count = &mut self.counts[key];
        let slot = usize::from(!*count) % SIZE;
        *count = count.wrapping_add(1);
        prefetch_for_store(&self.positions[key][slot]);
        prefetch_for_store(&self.tags[key]);
        self.positions[key][slot] = position as u32;
        self.tags[key][slot] = tag;
    }
}

impl<const LONG: bool, const BUCKETS: usize, const SIZE: usize> Hasher
    for TaggedBuckets<LONG, BUCKETS, SIZE>
{
    const LOOKAHEAD: usize = if LONG { 8 } else { 4 };

    fn recent_count(&self) -> usize {
        4
    }

    fn clear(&mut self) {
        self.counts.fill(0);
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        let (key, tag) = Self::key_and_tag(eight);
        self.insert(key, tag, position);
    }

    #[inline(always)]
    fn prefetch(&self, eight: u64) {
        let (key, _) = Self::key_and_tag(eight);
        prefetch_read(&raw const self.counts[key], Locality::L1);
        prefetch_read(&raw const self.tags[key], Locality::L1);
        for line in self.positions[key].as_chunks::<16>().0 {
            prefetch_read(line, Locality::L1);
        }
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, _: usize) -> Match {
        let (key, tag) = Self::key_and_tag(search.first_eight());
        let (count, positions, tags) = (self.counts[key], &self.positions[key], &self.tags[key]);
        let newest = usize::from(count.wrapping_neg()) % SIZE;
        let used = usize::from(count).min(SIZE);
        let equal = equal_tags(tags, tag);
        // From `newest` on, going around.
        let mut candidates = (equal | (equal << SIZE)) & (((1 << used) - 1) << newest);
        let mut best = Match::NONE;
        let length = search.try_recent(recent, 4, &mut best);
        let first_of = |candidates: u64| positions[candidates.trailing_zeros() as usize % SIZE];
        let nearest = match candidates {
            0 => 0,
            _ => search.position.wrapping_sub(first_of(candidates) as usize),
        };
        let length = search.raise(length, nearest, &self.words, &mut best);
        let mut filter = Filter::new(search, length);
        while candidates != 0 {
            let candidate = first_of(candidates) as usize;
            if !search.reaches_back_to(candidate) {
                break;
            }
            filter.try_position(search, candidate, search.position - candidate, &mut best);
            candidates &= candidates - 1;
        }
        self.insert(key, tag, search.position);
        search.try_words(&mut self.words, 2, &mut best);
        best
    }
}
