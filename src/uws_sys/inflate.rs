//! `bun_libdeflate` for `uWS::ZlibContext` (packages/bun-uws/src/PerMessageDeflate.h).

use bun_libdeflate::{Decompressor, Encoding};

use crate::thunk::c_slice;

struct Inflater {
    decompressor: Decompressor,
    output: Box<[u8]>,
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Inflater__create(output_size: usize) -> *mut Inflater {
    bun_core::heap::into_raw(Box::new(Inflater {
        decompressor: Decompressor::new(),
        output: vec![0; output_size].into_boxed_slice(),
    }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Inflater__destroy(this: *mut Inflater) {
    // SAFETY: `this` came from `Bun__Inflater__create` and the caller does not use it again.
    unsafe { bun_core::heap::destroy(this) };
}

/// Null unless `input` starts with a whole DEFLATE stream of at most `output_size` bytes. Valid until the next call with the same `Inflater`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Inflater__inflate(
    this: &mut Inflater,
    input: *const u8,
    input_len: usize,
    written: &mut usize,
) -> *const u8 {
    // SAFETY: the caller's `input_len` bytes, which outlive this call.
    let input = unsafe { c_slice(input, input_len) };
    match this
        .decompressor
        .decompress(input, &mut this.output, Encoding::Deflate)
    {
        Ok(decompressed) => {
            *written = decompressed.written;
            this.output.as_ptr()
        }
        Err(_) => core::ptr::null(),
    }
}
