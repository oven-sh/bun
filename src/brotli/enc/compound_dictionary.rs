//! Bytes that the encoder can refer to as if they came before the start of the stream.

use super::Fallible;
use crate::util::{Bug, SliceExt, load_u64_le, try_zeroed};

pub(crate) const MAX_COMPOUND_DICTS: usize = 15;

pub(crate) const PREPARED_DICTIONARY_HASH_MUL_64_LONG: u64 = 0x1FE3_5A7B_D357_9BD3;

/// A dictionary and an index of where in it each sequence of `hash_bits / 8` bytes occurs.
///
/// A hash selects a bucket, and its low `slot_bits` a slot. The positions of a bucket are the items from
/// `slot_offsets[slot] + heads[bucket]` up to the first one with the highest bit set.
pub struct PreparedDictionary {
    pub(crate) source: Box<[u8]>,
    pub(crate) hash_bits: u32,
    pub(crate) bucket_bits: u32,
    pub(crate) slot_bits: u32,
    /// One for each slot.
    pub(crate) slot_offsets: Vec<u32>,
    /// One for each bucket. 0xFFFF for an empty one.
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
        let mut slot_bits = 7u32;
        let hash_bits = 40u32;
        let bucket_limit = 32u16;
        let mut volume = 16usize << bucket_bits;
        // More buckets for a larger dictionary.
        while volume < source.len() && bucket_bits < 22 {
            bucket_bits += 1;
            slot_bits += 1;
            volume <<= 1;
        }
        Self::with_params(source, bucket_bits, slot_bits, hash_bits, bucket_limit).ok()
    }

    fn with_params(
        source: Box<[u8]>,
        bucket_bits: u32,
        slot_bits: u32,
        hash_bits: u32,
        bucket_limit: u16,
    ) -> Fallible<Self> {
        let source_size = source.len();
        let num_slots = 1usize << slot_bits;
        let num_buckets = 1usize << bucket_bits;
        let hash_shift = 64 - bucket_bits;
        let hash_mask = !0u64 >> (64 - hash_bits);
        let slot_mask = num_slots - 1;
        if slot_bits > 16 || slot_bits > bucket_bits || bucket_bits - slot_bits >= 16 {
            return Err(Bug.into());
        }

        // Step 1: chain the positions of each bucket, the last one first.
        let mut slot_size = try_zeroed::<u32>(num_slots)?;
        let mut slot_limit = try_zeroed::<u32>(num_slots)?;
        let mut num = try_zeroed::<u16>(num_buckets)?;
        let mut bucket_heads = try_zeroed::<u32>(num_buckets)?;
        let mut next_bucket = try_zeroed::<u32>(source_size)?;
        for i in 0..source_size.saturating_sub(7) {
            let h = (load_u64_le(&source, i)? & hash_mask)
                .wrapping_mul(PREPARED_DICTIONARY_HASH_MUL_64_LONG);
            let key = (h >> hash_shift) as usize;
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
            num.put(key, (count + 1).min(bucket_limit))?;
        }

        // Step 2: lower the limit of each slot until its buckets can be addressed with 16 bits.
        let mut total_items = 0u32;
        for i in 0..num_slots {
            let mut limit = u32::from(bucket_limit);
            loop {
                let mut count = 0u32;
                let mut overflow = false;
                for &size in num.sub(i..)?.iter().step_by(num_slots) {
                    // The last chain may reach past the limit. Only its start has to be addressable.
                    if count >= 0xFFFF {
                        overflow = true;
                        break;
                    }
                    count += u32::from(size).min(limit);
                }
                if !overflow {
                    slot_size.put(i, count)?;
                    total_items += count;
                    break;
                }
                limit -= 1;
            }
            slot_limit.put(i, limit)?;
        }

        // Step 3: lay the chains out one after the other.
        let mut slot_offsets = try_zeroed::<u32>(num_slots)?;
        let mut heads = try_zeroed::<u16>(num_buckets)?;
        let mut items = try_zeroed::<u32>(total_items as usize)?;
        total_items = 0;
        for (offset, size) in slot_offsets.iter_mut().zip(&mut slot_size) {
            *offset = total_items;
            total_items += *size;
            *size = 0;
        }
        for (i, head) in heads.iter_mut().enumerate() {
            let slot = i & slot_mask;
            let count = u32::from(num.at(i)?).min(slot_limit.at(slot)?);
            if count == 0 {
                *head = 0xFFFF;
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
            *items.at_mut(cursor - 1)? |= 0x8000_0000;
        }

        Ok(Self {
            source,
            hash_bits,
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
