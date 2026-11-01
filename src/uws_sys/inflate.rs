//! `bun_libdeflate` for `uWS::ZlibContext` (packages/bun-uws/src/PerMessageDeflate.h).

use bun_libdeflate::{Decoding, Decompressor};

use crate::thunk::c_slice;

struct Inflater {
    decompressor: Decompressor,
    output: Box<[u8]>,
}

impl Inflater {
    /// `None` unless `input` starts with a whole DEFLATE stream that fits `output`.
    fn inflate(&mut self, input: &[u8]) -> Option<&[u8]> {
        if !bun_core::feature_flags::is_libdeflate_enabled() {
            return None;
        }
        let counts = self
            .decompressor
            .decompress(input, &mut self.output, Decoding::Deflate)
            .ok()?;
        self.output.get(..counts.written)
    }
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

/// Null if [`Inflater::inflate`] has nothing. Otherwise `*written` bytes that are valid until the next call.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Inflater__inflate(
    this: *mut Inflater,
    input: *const u8,
    input_len: usize,
    written: *mut usize,
) -> *const u8 {
    // SAFETY: `this` came from `Bun__Inflater__create` and only its owner, on one thread, uses it. `input` is `input_len` bytes.
    let Some(inflated) = (unsafe { (*this).inflate(c_slice(input, input_len)) }) else {
        return core::ptr::null();
    };
    // SAFETY: the caller's `size_t`.
    unsafe { *written = inflated.len() };
    inflated.as_ptr()
}
