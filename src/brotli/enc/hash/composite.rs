//! Two hashers side by side.

use super::{HasherImpl, HasherSearchResult, StaticDictionarySearch};
use crate::util::Checked;
use bun_core::AllocError;

pub(crate) struct HashComposite<A, B> {
    ha: A,
    hb: B,
}

impl<A, B> HashComposite<A, B> {
    pub(crate) fn new(ha: A, hb: B) -> Self {
        Self { ha, hb }
    }
}

const fn max(a: usize, b: usize) -> usize {
    if a > b { a } else { b }
}

impl<A: HasherImpl, B: HasherImpl> HasherImpl for HashComposite<A, B> {
    const HASH_TYPE_LENGTH: usize = max(A::HASH_TYPE_LENGTH, B::HASH_TYPE_LENGTH);
    const STORE_LOOKAHEAD: usize = max(A::STORE_LOOKAHEAD, B::STORE_LOOKAHEAD);

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        self.ha.prepare(one_shot, input_size, data)?;
        self.hb.prepare(one_shot, input_size, data)
    }

    fn reserve(&mut self, input_end: usize) -> Result<(), AllocError> {
        self.ha.reserve(input_end)?;
        self.hb.reserve(input_end)
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        self.ha.store(data, mask, ix)?;
        self.hb.store(data, mask, ix)
    }

    #[inline(always)]
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        self.ha.store_range(data, mask, ix_start, ix_end)?;
        self.hb.store_range(data, mask, ix_start, ix_end)
    }

    fn stitch_to_previous_block(
        &mut self,
        num_bytes: usize,
        position: usize,
        ringbuffer: &[u8],
        ring_buffer_mask: usize,
    ) -> Checked {
        self.ha
            .stitch_to_previous_block(num_bytes, position, ringbuffer, ring_buffer_mask)?;
        self.hb
            .stitch_to_previous_block(num_bytes, position, ringbuffer, ring_buffer_mask)
    }

    #[inline(always)]
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]) {
        self.ha.prepare_distance_cache(distance_cache);
        self.hb.prepare_distance_cache(distance_cache);
    }

    #[inline(always)]
    fn find_longest_match(
        &mut self,
        dictionary: &mut StaticDictionarySearch<'_>,
        data: &[u8],
        ring_buffer_mask: usize,
        distance_cache: &[i32; 16],
        cur_ix: usize,
        max_length: usize,
        max_backward: usize,
        dictionary_distance: usize,
        max_distance: usize,
        out: &mut HasherSearchResult,
    ) -> Checked {
        self.ha.find_longest_match(
            dictionary,
            data,
            ring_buffer_mask,
            distance_cache,
            cur_ix,
            max_length,
            max_backward,
            dictionary_distance,
            max_distance,
            out,
        )?;
        self.hb.find_longest_match(
            dictionary,
            data,
            ring_buffer_mask,
            distance_cache,
            cur_ix,
            max_length,
            max_backward,
            dictionary_distance,
            max_distance,
            out,
        )
    }
}
