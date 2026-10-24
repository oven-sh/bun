//! `bun_hpack` for `uWS::Http2Connection` (packages/bun-uws/src/Http2Context.h).

use core::ffi::c_int;

use bun_hpack::{Decoder, Encoder, Error, Indexing};

use crate::thunk::c_slice;

/// How much room `block` keeps between header blocks.
const KEEP_BLOCK_CAPACITY: usize = 1024;

/// `BUN_HPACK_END_OF_BLOCK`.
const END_OF_BLOCK: c_int = -1;

/// RFC 9113 §7.
const COMPRESSION_ERROR: c_int = 0x9;
const ENHANCE_YOUR_CALM: c_int = 0xb;

struct Hpack {
    encoder: Encoder,
    decoder: Decoder,
    /// The header block being encoded.
    block: Vec<u8>,
}

/// `BunHpackField`. Valid until the next call with the same `Hpack`.
#[repr(C)]
struct HpackField {
    name: *const u8,
    value: *const u8,
    name_len: u32,
    value_len: u32,
    static_index: c_int,
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__create() -> *mut Hpack {
    bun_core::heap::into_raw(Box::new(Hpack {
        encoder: Encoder::with_history(),
        decoder: Decoder::new(),
        block: Vec::new(),
    }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__destroy(this: *mut Hpack) {
    // SAFETY: `this` came from `Bun__Hpack__create` and the caller does not use it again.
    unsafe { bun_core::heap::destroy(this) };
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__setEncoderMaxCapacity(this: &mut Hpack, max_capacity: u32) {
    this.encoder.set_max_capacity(max_capacity);
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__encode(
    this: &mut Hpack,
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
    add_to_table: bool,
) {
    // SAFETY: the caller's `name_len` and `value_len` bytes, which outlive this call.
    let (name, value) = unsafe { (c_slice(name, name_len), c_slice(value, value_len)) };
    let indexing = if add_to_table {
        Indexing::Add
    } else {
        Indexing::Skip
    };
    let encoded = this.encoder.encode(&mut this.block, name, value, indexing);
    if encoded.is_err() {
        this.encoder.encode_verbatim(&mut this.block, name, value);
    }
}

/// What was encoded since [`Bun__Hpack__clearBlock`]. Valid until the next call with the same `Hpack`.
#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__block(this: &Hpack, len: &mut usize) -> *const u8 {
    *len = this.block.len();
    this.block.as_ptr()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__clearBlock(this: &mut Hpack) {
    this.block.clear();
    this.block.shrink_to(KEEP_BLOCK_CAPACITY);
}

/// [`Decoder::next`]. Returns 0, [`END_OF_BLOCK`], or the error code to close the connection with.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__decode(
    this: &mut Hpack,
    block: *const u8,
    block_len: usize,
    position: &mut usize,
    field: &mut HpackField,
) -> c_int {
    // SAFETY: the caller's `block_len` bytes, which outlive this call.
    let block = unsafe { c_slice(block, block_len) };
    match this.decoder.next(block, position) {
        Some(Ok(decoded)) => {
            *field = HpackField {
                name: decoded.name.as_ptr(),
                value: decoded.value.as_ptr(),
                name_len: decoded.name.len() as u32,
                value_len: decoded.value.len() as u32,
                static_index: c_int::from(decoded.static_index),
            };
            0
        }
        None => END_OF_BLOCK,
        Some(Err(Error::TooLarge)) => ENHANCE_YOUR_CALM,
        Some(Err(Error::Invalid)) => COMPRESSION_ERROR,
    }
}
