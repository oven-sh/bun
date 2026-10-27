//! The settings of an encoder.

use super::compound_dictionary::CompoundDictionary;

/// `BrotliEncoderMode`: what kind of data to tune for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum EncoderMode {
    /// Nothing is known about the input.
    Generic = 0,
    /// UTF-8 text.
    Text = 1,
    /// WOFF 2.0 fonts.
    Font = 2,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct HasherParams {
    pub(crate) type_: i32,
    pub(crate) bucket_bits: i32,
    pub(crate) block_bits: i32,
    pub(crate) num_last_distances_to_check: i32,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DistanceParams {
    pub(crate) distance_postfix_bits: u32,
    pub(crate) num_direct_distance_codes: u32,
    pub(crate) alphabet_size_max: u32,
    pub(crate) alphabet_size_limit: u32,
    pub(crate) max_distance: usize,
}

pub(crate) struct EncoderParams {
    pub(crate) mode: EncoderMode,
    pub(crate) quality: i32,
    pub(crate) lgwin: i32,
    pub(crate) lgblock: i32,
    pub(crate) stream_offset: usize,
    pub(crate) size_hint: usize,
    pub(crate) disable_literal_context_modeling: bool,
    pub(crate) large_window: bool,
    pub(crate) hasher: HasherParams,
    pub(crate) dist: DistanceParams,
    pub(crate) dictionary: CompoundDictionary,
}
