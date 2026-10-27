//! The encoder.

mod backward_references;
mod backward_references_hq;
mod bit_cost;
mod bit_stream;
mod bit_writer;
mod block_splitter;
mod cluster;
mod command;
mod compound_dictionary;
mod compress_fragment;
mod compress_fragment_two_pass;
mod dictionary_hash;
mod encoder;
mod entropy_encode;
mod entropy_encode_static;
mod fast_log;
mod find_match_length;
mod hash;
mod histogram;
mod literal_cost;
mod meta_block;
mod params;
mod ring_buffer;
mod static_dict;
mod static_dict_lut;
mod utf8_util;

pub use compound_dictionary::PreparedDictionary;
pub use encoder::{Encoder, compress, compress_append, max_compressed_size};
pub use params::EncoderMode;

use crate::util::Bug;
use bun_core::AllocError;

pub const MIN_WINDOW_BITS: i32 = 10;
/// Without [`EncoderParameter::LargeWindow`].
pub const MAX_WINDOW_BITS: i32 = 24;
pub const LARGE_MAX_WINDOW_BITS: i32 = 30;
pub const MIN_INPUT_BLOCK_BITS: i32 = 16;
pub const MAX_INPUT_BLOCK_BITS: i32 = 24;
pub const MIN_QUALITY: i32 = 0;
pub const MAX_QUALITY: i32 = 11;
pub const DEFAULT_QUALITY: i32 = 11;
pub const DEFAULT_WINDOW: i32 = 22;

/// `BrotliEncoderOperation`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum EncoderOperation {
    /// Take input. Output is produced when the encoder sees fit.
    Process = 0,
    /// Produce output for all the input taken so far.
    Flush = 1,
    /// End the stream.
    Finish = 2,
    /// Write the input as a metadata block, which a decoder skips.
    EmitMetadata = 3,
}

/// `BrotliEncoderParameter`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum EncoderParameter {
    /// An [`EncoderMode`].
    Mode = 0,
    /// [`MIN_QUALITY`] to [`MAX_QUALITY`]. Higher is slower and denser.
    Quality = 1,
    /// `log2` of the sliding window.
    Lgwin = 2,
    /// `log2` of the largest input block, or 0 to derive it from the quality.
    Lgblock = 3,
    DisableLiteralContextModeling = 4,
    /// An estimate of the total input size, or 0 if it is not known.
    SizeHint = 5,
    /// Allow windows over [`MAX_WINDOW_BITS`], which is not RFC 7932.
    LargeWindow = 6,
    Npostfix = 7,
    Ndirect = 8,
    /// How many bytes of the stream were already written by another encoder.
    StreamOffset = 9,
}

impl EncoderParameter {
    pub const fn from_raw(raw: u32) -> Option<Self> {
        Some(match raw {
            0 => Self::Mode,
            1 => Self::Quality,
            2 => Self::Lgwin,
            3 => Self::Lgblock,
            4 => Self::DisableLiteralContextModeling,
            5 => Self::SizeHint,
            6 => Self::LargeWindow,
            7 => Self::Npostfix,
            8 => Self::Ndirect,
            9 => Self::StreamOffset,
            _ => return None,
        })
    }
}

/// Why the encoder gave up. It cannot be used after that.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Failure {
    Bug,
    OutOfMemory,
}

impl From<Bug> for Failure {
    #[cold]
    fn from(_: Bug) -> Self {
        Self::Bug
    }
}

impl From<AllocError> for Failure {
    #[cold]
    fn from(_: AllocError) -> Self {
        Self::OutOfMemory
    }
}

pub(crate) type Fallible<T = ()> = Result<T, Failure>;
