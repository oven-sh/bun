//! The zstd side of the source text in a compiled program: `BunAOTCompile.cpp` compresses it and
//! `BunCompiledModules.cpp` decompresses it.

/// # Safety
/// `ptr` is valid for writes of `len` bytes that nothing else uses for `'a`. They need not be initialized.
unsafe fn zeroed<'a>(ptr: *mut u8, len: usize) -> &'a mut [u8] {
    // SAFETY: the caller's contract, and then the bytes are initialized.
    unsafe {
        ptr.write_bytes(0, len);
        bun_core::ffi::slice_mut(ptr, len)
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__maxCompressedSourceSize(text_size: usize) -> usize {
    bun_zstd::compress_bound(text_size)
}

/// Compresses `text` to `compressed`. Returns the size of the frame, or 0 if it fails.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__compressSource(
    compressed: *mut u8,
    compressed_capacity: usize,
    text: *const u8,
    text_size: usize,
) -> usize {
    // SAFETY: the caller's contract.
    let (compressed, text) = unsafe {
        (
            zeroed(compressed, compressed_capacity),
            bun_core::ffi::slice(text, text_size),
        )
    };
    bun_zstd::compress(compressed, text, 3).unwrap_or(0)
}

/// Decompresses `compressed` to `text`. False unless it fills `text`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOT__decompressSource(
    text: *mut u8,
    text_size: usize,
    compressed: *const u8,
    compressed_size: usize,
) -> bool {
    // SAFETY: the caller's contract.
    let (text, compressed) = unsafe {
        (
            zeroed(text, text_size),
            bun_core::ffi::slice(compressed, compressed_size),
        )
    };
    bun_zstd::DCtx::new().decompress(text, compressed) == Ok(text_size)
}
