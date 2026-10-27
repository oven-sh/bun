//! The bodies of libdeflate_test.bind.ts.

use core::mem::MaybeUninit;

use bun_libdeflate::{Compressor, Decompressor, Error, Level};

use crate::generated_bindgen::libdeflate_test::{
    CompressToSliceOptions, CompressToVecOptions, Decoding, DecompressToSliceOptions,
    DecompressToVecOptions, Encoding, Outcome,
};

const HELD: u8 = 0xAA;
const SPARE: u8 = 0x55;

fn encoding(encoding: Encoding) -> bun_libdeflate::Encoding {
    match encoding {
        Encoding::Deflate => bun_libdeflate::Encoding::Deflate,
        Encoding::Zlib => bun_libdeflate::Encoding::Zlib,
        Encoding::Gzip => bun_libdeflate::Encoding::Gzip,
    }
}

fn decoding(decoding: Decoding) -> bun_libdeflate::Decoding {
    match decoding {
        Decoding::Deflate => bun_libdeflate::Decoding::Deflate,
        Decoding::Gzip => bun_libdeflate::Decoding::Gzip,
    }
}

const NOTHING: Outcome = Outcome {
    error: None,
    read: None,
    written: 0,
    crc32: 0,
    kept_what_it_held: None,
    moved: None,
    capacity: None,
    touched_past_end: None,
};

fn failure(error: &dyn core::fmt::Display) -> Outcome {
    Outcome {
        error: Some(error.to_string().into_bytes()),
        ..NOTHING
    }
}

/// `result` is the number of bytes a call said it wrote, and `written` what it did write.
fn outcome(result: Result<usize, Error>, written: &[u8]) -> Outcome {
    let said = match result {
        Ok(said) => said,
        Err(_) if !written.is_empty() => return failure(&"an error left output behind"),
        Err(err) => return failure(&err),
    };
    if said != written.len() {
        return failure(&format_args!("wrote {}, not {said} bytes", written.len()));
    }
    Outcome {
        written: said,
        crc32: bun_zlib::crc32_bytes(0, written),
        ..NOTHING
    }
}

/// What became of a `Vec` from `vec_of(held, _)`, then at `address`, on top of the `outcome` of what was appended to it.
fn vec_outcome(
    result: Result<usize, Error>,
    vec: &mut Vec<u8>,
    held: usize,
    address: *const u8,
) -> Outcome {
    let moved = vec.as_ptr() != address;
    let touched_past_end = (!moved).then(|| {
        let spare = vec.spare_capacity_mut();
        // SAFETY: `vec_of` wrote all of this allocation.
        let is_untouched = |byte: &&mut MaybeUninit<u8>| unsafe { byte.assume_init() } == SPARE;
        spare.len() - spare.iter_mut().rev().take_while(is_untouched).count()
    });
    let (kept, appended) = vec.split_at(held.min(vec.len()));
    Outcome {
        kept_what_it_held: Some(kept.len() == held && kept.iter().all(|&byte| byte == HELD)),
        moved: Some(moved),
        capacity: Some(vec.capacity()),
        touched_past_end,
        ..outcome(result, appended)
    }
}

/// A `Vec` that holds `held` bytes and has room for `spare` more.
fn vec_of(held: usize, spare: usize) -> Vec<u8> {
    let mut vec = Vec::with_capacity(held + spare);
    vec.resize(held, HELD);
    vec.spare_capacity_mut().fill(MaybeUninit::new(SPARE));
    vec
}

fn new_compressor(level: i32) -> Result<Compressor, Outcome> {
    let level = Level::new(level).ok_or_else(|| failure(&"no such level"))?;
    Compressor::new(level).map_err(|err| failure(&err))
}

pub(crate) fn max_bytes_needed(input_length: usize, format: Encoding) -> usize {
    Compressor::max_bytes_needed(input_length, encoding(format))
}

pub(crate) fn compress_to_slice(
    input: &[u8],
    options: &CompressToSliceOptions,
    first: Option<&[u8]>,
) -> Outcome {
    let mut compressor = match new_compressor(options.level) {
        Ok(compressor) => compressor,
        Err(outcome) => return outcome,
    };
    let format = encoding(options.encoding);
    if let Some(first) = first {
        _ = compressor.compress_to_vec(first, &mut Vec::new(), format);
    }
    let mut output = vec![HELD; options.room];
    let result = compressor.compress(input, &mut output, format);
    outcome(result, &output[..result.unwrap_or(0)])
}

pub(crate) fn compress_to_vec(input: &[u8], options: &CompressToVecOptions) -> Outcome {
    let mut compressor = match new_compressor(options.level) {
        Ok(compressor) => compressor,
        Err(outcome) => return outcome,
    };
    let mut output = vec_of(options.held, options.spare);
    let address = output.as_ptr();
    let result = compressor.compress_to_vec(input, &mut output, bun_libdeflate::Encoding::Deflate);
    vec_outcome(result, &mut output, options.held, address)
}

pub(crate) fn decompress_to_slice(
    stream: &[u8],
    options: &DecompressToSliceOptions,
    first: Option<&[u8]>,
) -> Outcome {
    let mut decompressor = Decompressor::new();
    let format = decoding(options.decoding);
    if let Some(first) = first {
        _ = decompressor.decompress_to_vec_grow(first, &mut Vec::new(), format, usize::MAX);
    }
    let mut output = vec![HELD; options.room];
    let result = decompressor.decompress(stream, &mut output, format);
    Outcome {
        read: result.ok().map(|counts| counts.read),
        ..outcome(
            result.map(|counts| counts.written),
            &output[..result.map_or(0, |counts| counts.written)],
        )
    }
}

pub(crate) fn decompress_to_vec(stream: &[u8], options: &DecompressToVecOptions) -> Outcome {
    let mut decompressor = Decompressor::new();
    let format = decoding(options.decoding);
    let mut output = vec_of(options.held, options.spare);
    let address = output.as_ptr();
    let result = match options.max_length {
        Some(max) => decompressor.decompress_to_vec_grow(stream, &mut output, format, max),
        None => decompressor.decompress_to_vec(stream, &mut output, format),
    };
    Outcome {
        read: result.ok().map(|counts| counts.read),
        ..vec_outcome(
            result.map(|counts| counts.written),
            &mut output,
            options.held,
            address,
        )
    }
}
