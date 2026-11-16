use super::hash::Search;
use super::params::Params;
use super::prepared_dictionary::{PreparedDictionary, Query};
use super::ring_buffer::{SLACK, Window};

/// The piece of input that is turned into commands in one go.
#[derive(Clone, Copy)]
pub(super) struct InputBlock<'a> {
    pub(super) window: Window<'a>,
    pub(super) position: usize,
    pub(super) length: usize,
    pub(super) is_last: bool,
    pub(super) params: &'a Params,
    pub(super) dictionary: Option<&'a PreparedDictionary>,
    max_backward_distance: usize,
    dictionary_size: usize,
}

impl<'a> InputBlock<'a> {
    pub(super) fn new(
        window: Window<'a>,
        position: usize,
        length: usize,
        is_last: bool,
        params: &'a Params,
        dictionary: Option<&'a PreparedDictionary>,
    ) -> Self {
        Self {
            window,
            position,
            length,
            is_last,
            params,
            dictionary,
            max_backward_distance: params.max_backward_distance(),
            dictionary_size: dictionary.map_or(0, |dictionary| dictionary.bytes().len()),
        }
    }

    pub(super) fn without_first(&self, count: usize) -> Self {
        Self {
            position: self.position + count,
            length: self.length - count,
            ..*self
        }
    }

    /// Whether it is too early to allocate for a long input.
    pub(super) fn may_be_all(&self) -> bool {
        self.position == 0 && (self.is_last || self.length < self.params.block_size())
    }

    /// Whether the ring does not end within the block or the window before it.
    #[inline(always)]
    pub(super) fn is_contiguous(&self) -> bool {
        self.window.index(self.position) >= self.max_backward(self.position)
            && self.length <= self.window.before_end(self.position) + 1
    }

    #[inline(always)]
    pub(super) fn end(&self) -> usize {
        self.position + self.length
    }

    #[inline(always)]
    pub(super) fn data_from(&self, position: usize) -> &'a [u8] {
        &self.window.from(position)[..self.end() - position]
    }

    #[inline(always)]
    pub(super) fn max_backward(&self, position: usize) -> usize {
        position.min(self.max_backward_distance)
    }

    /// The prepared dictionary comes after this distance.
    #[inline(always)]
    pub(super) fn dictionary_end_distance(&self, position: usize) -> usize {
        self.max_backward(position + self.params.stream_offset)
    }

    /// The words of the static dictionary come after this distance.
    #[inline(always)]
    pub(super) fn max_copy_distance(&self, position: usize) -> usize {
        self.dictionary_end_distance(position) + self.dictionary_size
    }

    /// Positions from here on have too little after them to be stored.
    pub(super) fn store_end(&self, lookahead: usize) -> usize {
        self.position + (self.length + 1).saturating_sub(lookahead)
    }

    #[inline(always)]
    pub(super) fn padded(&self) -> &'a [u8] {
        &self.window.from(self.position)[..self.length + SLACK]
    }

    /// `padded` is what is left of [`padded`](Self::padded).
    #[inline(always)]
    pub(super) fn search_at(&'a self, position: usize, padded: &'a [u8]) -> Search<'a> {
        Search {
            window: self.window,
            position,
            padded,
            max_backward: self.max_backward(position),
            block: self,
            to_beat: 0,
        }
    }

    pub(super) fn query_at(&self, position: usize) -> Query<'a> {
        Query {
            data: self.data_from(position),
            eight_bytes: u64::from_le_bytes(self.window.bytes_at(position)),
            before_ring_end: self.window.before_end(position),
            end_distance: self.dictionary_end_distance(position),
            max_distance: self.params.distance.max_distance,
        }
    }
}
