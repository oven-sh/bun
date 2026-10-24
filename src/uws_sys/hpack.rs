//! `bun_hpack` for `uWS::Http2Connection` (packages/bun-uws/src/Http2Context.h).

use core::ffi::c_int;

use bun_hpack::{Block, Decoder, Encoder, Error, Indexing};

/// A longer name or value is sent as it is.
const MAX_COMPRESSED_STRING_LEN: usize = 32767;

/// How much room `block` keeps between header blocks.
const KEEP_BLOCK_CAPACITY: usize = 1024;

/// RFC 9113 §7.
const COMPRESSION_ERROR: c_int = 0x9;
const ENHANCE_YOUR_CALM: c_int = 0xb;

struct Hpack {
    encoder: Encoder,
    decoder: Decoder,
    /// The header block being encoded.
    block: Vec<u8>,
}

/// `BunHpackField`. Valid until the next call with the same `Hpack`, or as long as the header block if that is less.
#[repr(C)]
struct HpackField {
    name: *const u8,
    value: *const u8,
    name_len: u32,
    value_len: u32,
    static_index: c_int,
}

/// # Safety
/// `ptr` points to `len` initialised bytes that stay as they are for `'a`, or `len` is 0.
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        return &[];
    }
    // SAFETY: see above.
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__create() -> *mut Hpack {
    bun_core::heap::into_raw(Box::new(Hpack {
        encoder: Encoder::new(true),
        decoder: Decoder::new(),
        block: Vec::new(),
    }))
}

/// # Safety
/// `this` came from [`Bun__Hpack__create`] and is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__destroy(this: *mut Hpack) {
    // SAFETY: see above.
    unsafe { bun_core::heap::destroy(this) };
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__setEncoderMaxCapacity(this: &mut Hpack, max_capacity: u32) {
    this.encoder.set_max_capacity(max_capacity);
}

/// # Safety
/// `name` and `value` point to `name_len` and `value_len` initialised bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__encode(
    this: &mut Hpack,
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
    add_to_table: bool,
) {
    // SAFETY: see above. Neither borrow outlives this call.
    let (name, value) = unsafe { (bytes(name, name_len), bytes(value, value_len)) };
    let indexing = if add_to_table {
        Indexing::Add
    } else {
        Indexing::Skip
    };
    if name.len() > MAX_COMPRESSED_STRING_LEN
        || value.len() > MAX_COMPRESSED_STRING_LEN
        || this
            .encoder
            .encode(&mut this.block, name, value, indexing)
            .is_err()
    {
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

/// Returns 0, or the error code to close the connection with.
///
/// # Safety
/// `block` points to `block_len` initialised bytes, the whole header block. `*position` is 0 or
/// what an earlier call for the same block left there.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__decode(
    this: &mut Hpack,
    block: *const u8,
    block_len: usize,
    position: &mut usize,
    field: &mut HpackField,
) -> c_int {
    // SAFETY: see above. `field` may point into it, which `HpackField` documents.
    let src = unsafe { bytes(block, block_len) };
    let mut block = Block::resume(src, *position);
    match this.decoder.next(&mut block) {
        Some(Ok(decoded)) => {
            *field = HpackField {
                name: decoded.name.as_ptr(),
                value: decoded.value.as_ptr(),
                name_len: decoded.name.len() as u32,
                value_len: decoded.value.len() as u32,
                static_index: c_int::from(decoded.static_index),
            };
            *position = block.position();
            0
        }
        Some(Err(Error::TooLarge)) => ENHANCE_YOUR_CALM,
        Some(Err(Error::Invalid)) | None => COMPRESSION_ERROR,
    }
}
