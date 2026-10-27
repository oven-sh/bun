//! Bytes that the encoder can refer to as if they came before the start of the stream.

use super::Fallible;
use crate::util::{SliceExt, load_u64_le, try_zeroed};

pub(crate) const MAX_COMPOUND_DICTS: usize = 15;

/// Of the positions with the same hash, only this many are kept, the last ones.
const BUCKET_LIMIT: u16 = 32;
/// `log2` of how many buckets share a slot.
const BUCKETS_PER_SLOT_BITS: u32 = 10;
/// In `heads`.
pub(crate) const EMPTY_BUCKET: u16 = 0xFFFF;
/// Set in the last item of a bucket.
pub(crate) const LAST_ITEM_FLAG: u32 = 1 << 31;

// Where a bucket starts in its slot fits in `heads`.
const _: () = assert!((BUCKET_LIMIT as u32) << BUCKETS_PER_SLOT_BITS < EMPTY_BUCKET as u32);

/// The bucket of the 5 bytes in the low bits of `bytes`.
#[inline(always)]
pub(crate) fn bucket_index(bytes: u64, bucket_bits: u32) -> usize {
    const MASK: u64 = (1 << 40) - 1;
    const MULTIPLIER: u64 = 0x1FE3_5A7B_D357_9BD3;
    ((bytes & MASK).wrapping_mul(MULTIPLIER) >> (64 - bucket_bits)) as usize
}

/// A dictionary and an index of where in it each sequence of 5 bytes occurs.
///
/// The low `slot_bits` of the index of a bucket select a slot. The positions of a bucket are the items from
/// `slot_offsets[slot] + heads[bucket]` up to the first one with [`LAST_ITEM_FLAG`].
pub struct PreparedDictionary {
    pub(crate) source: Box<[u8]>,
    pub(crate) bucket_bits: u32,
    pub(crate) slot_bits: u32,
    /// One for each slot.
    pub(crate) slot_offsets: Vec<u32>,
    /// One for each bucket, or [`EMPTY_BUCKET`].
    pub(crate) heads: Vec<u16>,
    pub(crate) items: Vec<u32>,
}

impl PreparedDictionary {
    /// `None` if `source` is 2 GiB or more, or if memory runs out.
    pub fn new(source: Box<[u8]>) -> Option<Self> {
        if i32::try_from(source.len()).is_err() {
            return None;
        }
        let mut bucket_bits = 17u32;
        let mut volume = 16usize << bucket_bits;
        // More buckets for a larger dictionary.
        while volume < source.len() && bucket_bits < 22 {
            bucket_bits += 1;
            volume <<= 1;
        }
        Self::with_bucket_bits(source, bucket_bits).ok()
    }

    fn with_bucket_bits(source: Box<[u8]>, bucket_bits: u32) -> Fallible<Self> {
        let slot_bits = bucket_bits - BUCKETS_PER_SLOT_BITS;
        let num_slots = 1usize << slot_bits;
        let num_buckets = 1usize << bucket_bits;
        let slot_mask = num_slots - 1;

        // Chain the positions of each bucket, the last one first.
        let mut num = try_zeroed::<u16>(num_buckets)?;
        let mut bucket_heads = try_zeroed::<u32>(num_buckets)?;
        let mut next_bucket = try_zeroed::<u32>(source.len())?;
        for i in 0..source.len().saturating_sub(7) {
            let key = bucket_index(load_u64_le(&source, i)?, bucket_bits);
            let count = num.at(key)?;
            next_bucket.put(
                i,
                if count == 0 {
                    u32::MAX
                } else {
                    bucket_heads.at(key)?
                },
            )?;
            bucket_heads.put(key, i as u32)?;
            num.put(key, (count + 1).min(BUCKET_LIMIT))?;
        }

        // Lay the chains out one after the other, those of a slot together.
        let mut slot_size = try_zeroed::<u32>(num_slots)?;
        for (i, &count) in num.iter().enumerate() {
            *slot_size.at_mut(i & slot_mask)? += u32::from(count);
        }
        let mut slot_offsets = try_zeroed::<u32>(num_slots)?;
        let mut total_items = 0u32;
        for (offset, size) in slot_offsets.iter_mut().zip(&mut slot_size) {
            *offset = total_items;
            total_items += *size;
            *size = 0;
        }
        let mut heads = try_zeroed::<u16>(num_buckets)?;
        let mut items = try_zeroed::<u32>(total_items as usize)?;
        for (i, head) in heads.iter_mut().enumerate() {
            let slot = i & slot_mask;
            let count = u32::from(num.at(i)?);
            if count == 0 {
                *head = EMPTY_BUCKET;
                continue;
            }
            let size = slot_size.at_mut(slot)?;
            *head = *size as u16;
            let mut cursor = (*size + slot_offsets.at(slot)?) as usize;
            *size += count;
            let mut pos = bucket_heads.at(i)?;
            for _ in 0..count {
                items.put(cursor, pos)?;
                cursor += 1;
                pos = next_bucket.at(pos as usize)?;
            }
            *items.at_mut(cursor - 1)? |= LAST_ITEM_FLAG;
        }

        Ok(Self {
            source,
            bucket_bits,
            slot_bits,
            slot_offsets,
            heads,
            items,
        })
    }
}

/// Up to [`MAX_COMPOUND_DICTS`] dictionaries, one after the other.
#[derive(Default)]
pub(crate) struct CompoundDictionary {
    pub(crate) chunks: Vec<PreparedDictionary>,
    pub(crate) total_size: usize,
    /// Where each chunk starts, and where the last one ends.
    pub(crate) chunk_offsets: [usize; MAX_COMPOUND_DICTS + 1],
}

impl CompoundDictionary {
    /// `false` if there are too many already, or if memory runs out.
    pub(crate) fn attach(&mut self, dictionary: PreparedDictionary) -> bool {
        if self.chunks.len() == MAX_COMPOUND_DICTS || self.chunks.try_reserve(1).is_err() {
            return false;
        }
        self.total_size += dictionary.source.len();
        self.chunks.push(dictionary);
        self.chunk_offsets
            .put(self.chunks.len(), self.total_size)
            .is_ok()
    }
}
