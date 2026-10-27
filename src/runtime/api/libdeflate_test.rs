//! The bodies of libdeflate_test.bind.ts.

use bun_libdeflate::{Compressor, Decompressed, Decompressor, Error};

use crate::generated_bindgen::libdeflate_test::{
    CompressToSliceOptions, CompressToVecOptions, Decoding, DecompressToSliceOptions,
    DecompressToVecOptions, Encoding, Outcome,
};

const HELD: u8 = 0xAA;

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

fn outcome(error: Option<String>, written: &[u8]) -> Outcome {
    Outcome {
        error: error.map(String::into_bytes),
        read: None,
        written: written.len(),
        crc32: bun_zlib::crc32_bytes(0, written),
        kept_what_it_held: None,
        moved: None,
        capacity: None,
    }
}

fn message<T>(result: Result<T, Error>) -> Option<String> {
    result.err().map(|err| err.to_string())
}

/// A `Vec` that holds `held` bytes and has room for exactly `spare` more.
fn vec_of(held: usize, spare: usize) -> Vec<u8> {
    let mut vec = Vec::with_capacity(held + spare);
    assert_eq!(vec.capacity(), held + spare);
    vec.resize(held, HELD);
    vec
}

fn compressor(level: i32, format: Encoding, first: Option<&[u8]>) -> Result<Compressor, Outcome> {
    let mut compressor =
        Compressor::new(level).ok_or_else(|| outcome(Some("no such level".into()), &[]))?;
    if let Some(first) = first {
        _ = compressor.compress_to_vec(first, &mut Vec::new(), encoding(format));
    }
    Ok(compressor)
}

fn decompressor(format: Decoding, first: Option<&[u8]>) -> Decompressor {
    let mut decompressor = Decompressor::new();
    if let Some(first) = first {
        _ = decompressor.decompress_to_vec_grow(
            first,
            &mut Vec::new(),
            decoding(format),
            usize::MAX,
        );
    }
    decompressor
}

pub(crate) fn max_bytes_needed(input_length: usize, format: Encoding) -> usize {
    Compressor::max_bytes_needed(input_length, encoding(format))
}

pub(crate) fn compress_to_slice(
    input: &[u8],
    options: &CompressToSliceOptions,
    first: Option<&[u8]>,
) -> Outcome {
    let mut compressor = match compressor(options.level, options.encoding, first) {
        Ok(compressor) => compressor,
        Err(outcome) => return outcome,
    };
    let mut output = vec![HELD; options.room];
    let result = compressor.compress(input, &mut output, encoding(options.encoding));
    outcome(message(result), &output[..result.unwrap_or(0)])
}

pub(crate) fn compress_to_vec(
    input: &[u8],
    options: &CompressToVecOptions,
    first: Option<&[u8]>,
) -> Outcome {
    let mut compressor = match compressor(options.level, options.encoding, first) {
        Ok(compressor) => compressor,
        Err(outcome) => return outcome,
    };
    let mut output = vec_of(options.held, options.spare);
    let at = output.as_ptr();
    let result = compressor.compress_to_vec(input, &mut output, encoding(options.encoding));
    let (held, added) = output.split_at(options.held.min(output.len()));
    assert_eq!(result.unwrap_or(0), added.len());
    Outcome {
        kept_what_it_held: Some(held.len() == options.held && held.iter().all(|&b| b == HELD)),
        moved: Some(output.as_ptr() != at),
        capacity: Some(output.capacity()),
        ..outcome(message(result), added)
    }
}

pub(crate) fn decompress_to_slice(
    stream: &[u8],
    options: &DecompressToSliceOptions,
    first: Option<&[u8]>,
) -> Outcome {
    let mut output = vec![HELD; options.room];
    let result = decompressor(options.decoding, first).decompress(
        stream,
        &mut output,
        decoding(options.decoding),
    );
    Outcome {
        read: result.ok().map(|done| done.read),
        ..outcome(
            message(result),
            &output[..result.map_or(0, |done| done.written)],
        )
    }
}

pub(crate) fn decompress_to_vec(
    stream: &[u8],
    options: &DecompressToVecOptions,
    first: Option<&[u8]>,
) -> Outcome {
    let mut decompressor = decompressor(options.decoding, first);
    let format = decoding(options.decoding);
    let mut output = vec_of(options.held, options.spare);
    let at = output.as_ptr();
    let (result, held): (Result<Decompressed, Error>, usize) = match options.max_length {
        Some(max) => (
            decompressor.decompress_to_vec_grow(stream, &mut output, format, max),
            0,
        ),
        None => (
            decompressor.decompress_to_vec(stream, &mut output, format),
            options.held,
        ),
    };
    let (kept, added) = output.split_at(held.min(output.len()));
    assert_eq!(result.map_or(0, |done| done.written), added.len());
    Outcome {
        read: result.ok().map(|done| done.read),
        kept_what_it_held: options
            .max_length
            .is_none()
            .then(|| kept.len() == held && kept.iter().all(|&b| b == HELD)),
        moved: Some(output.as_ptr() != at),
        capacity: Some(output.capacity()),
        ..outcome(message(result), added)
    }
}
