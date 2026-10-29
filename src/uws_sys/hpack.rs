//! `bun_hpack` for `uWS::Http2Connection` (packages/bun-uws/src/Http2Context.h).

use core::ffi::c_int;

use bun_hpack::{Decoder, Encoder, Error, Indexing};

use crate::thunk::c_slice;

/// How much room `block` keeps between header blocks.
const KEEP_BLOCK_CAPACITY: usize = 1024;

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

/// `BunHpackResult`.
#[repr(C)]
enum HpackResult {
    Field,
    EndOfBlock,
    Invalid,
    TooLarge,
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

/// [`Decoder::next`]. `field` is written for [`HpackResult::Field`] only.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__decode(
    this: &mut Hpack,
    block: *const u8,
    block_len: usize,
    position: &mut usize,
    field: &mut HpackField,
) -> HpackResult {
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
            HpackResult::Field
        }
        None => HpackResult::EndOfBlock,
        Some(Err(Error::Invalid)) => HpackResult::Invalid,
        Some(Err(Error::TooLarge)) => HpackResult::TooLarge,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As `Http2Context.h` does it: one raw pointer to the `Hpack`, and what a call hands out is read after it returned.
    #[test]
    fn pointers_stay_valid_until_the_next_call() {
        let too_large = vec![b'~'; 70_000];
        let fields: [(&[u8], &[u8], bool); 4] = [
            (b":status", b"200", false),
            (b"x-a", b"hello world", true),
            (b"x-a", b"hello world", true),
            (b"x-b", &too_large, true),
        ];
        let mut field = HpackField {
            name: core::ptr::null(),
            value: core::ptr::null(),
            name_len: 0,
            value_len: 0,
            static_index: 0,
        };
        for capacity in [4096, 0, 100] {
            let hpack = Bun__Hpack__create();
            // SAFETY: `hpack` is live until `Bun__Hpack__destroy`, and every pointer is read before the next call.
            unsafe {
                // An empty block has no address.
                let end = Bun__Hpack__decode(&mut *hpack, core::ptr::null(), 0, &mut 0, &mut field);
                assert!(matches!(end, HpackResult::EndOfBlock));

                Bun__Hpack__setEncoderMaxCapacity(&mut *hpack, capacity);
                for (name, value, add) in fields {
                    let (name_len, value_len) = (name.len(), value.len());
                    let (name, value) = (name.as_ptr(), value.as_ptr());
                    Bun__Hpack__encode(&mut *hpack, name, name_len, value, value_len, add);
                }
                let mut len = 0;
                let block = Bun__Hpack__block(&*hpack, &mut len);
                let block = core::slice::from_raw_parts(block, len).to_vec();
                Bun__Hpack__clearBlock(&mut *hpack);

                let (mut position, mut decoded) = (0, Vec::new());
                let last = loop {
                    let (block, len) = (block.as_ptr(), block.len());
                    let result =
                        Bun__Hpack__decode(&mut *hpack, block, len, &mut position, &mut field);
                    let HpackResult::Field = result else {
                        break result;
                    };
                    let name = core::slice::from_raw_parts(field.name, field.name_len as usize);
                    let value = core::slice::from_raw_parts(field.value, field.value_len as usize);
                    decoded.push((name.to_vec(), value.to_vec(), field.static_index));
                };
                // The last field is sent as it is, and this side's own decoder refuses it.
                assert!(matches!(last, HpackResult::TooLarge));
                let expected = fields.map(|(name, value, _)| (name.to_vec(), value.to_vec()));
                assert_eq!(decoded.len(), 3);
                for ((name, value, static_index), expected) in decoded.into_iter().zip(expected) {
                    assert_eq!((name, value), expected);
                    assert_eq!(static_index, if expected.0 == b":status" { 8 } else { 0 });
                }
                Bun__Hpack__destroy(hpack);
            }
        }
        let hpack = Bun__Hpack__create();
        // SAFETY: as above.
        unsafe {
            let invalid = Bun__Hpack__decode(&mut *hpack, [0x80].as_ptr(), 1, &mut 0, &mut field);
            assert!(matches!(invalid, HpackResult::Invalid));
            Bun__Hpack__destroy(hpack);
        }
    }
}
