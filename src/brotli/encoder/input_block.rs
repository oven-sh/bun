use super::params::Params;
use super::prepared_dictionary::{PreparedDictionary, Query};
use super::ring_buffer::Window;

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
