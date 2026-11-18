//! The kernels of `bun_zstd_encoder`, from src/jsc/bindings/highway_zstd.cpp. On most CPUs, they leave the work to the caller.

cfg_select! {
    all(target_arch = "x86_64", not(any(miri, feature = "test_support"))) => {
        unsafe extern "C" {
            fn highway_zstd_write_codes(
                symbols: *const u8,
                count: usize,
                codes: &[u16; 256],
                out: *mut u8,
                room: usize,
                written: &mut Written,
            ) -> bool;

            fn highway_zstd_count_bytes(
                bytes: *const u8,
                len: usize,
                counts: &mut [u32; 256],
            ) -> bool;
        }

        /// After a pause, Intel's cores take 2 microseconds to get ready for them.
        #[inline(always)]
        pub fn are_quicker_for(count: usize) -> bool {
            count >= 4096 && is_x86_feature_detected!("avx512vbmi2")
        }
    }
    _ => {
        unsafe fn highway_zstd_write_codes(
            _: *const u8,
            _: usize,
            _: &[u16; 256],
            _: *mut u8,
            _: usize,
            _: &mut Written,
        ) -> bool {
            false
        }

        unsafe fn highway_zstd_count_bytes(_: *const u8, _: usize, _: &mut [u32; 256]) -> bool {
            false
        }

        #[inline(always)]
        pub fn are_quicker_for(_: usize) -> bool {
            false
        }
    }
}

#[derive(Default)]
#[repr(C)]
pub struct Written {
    /// In bytes.
    pub len: u64,
    /// Those that do not fill a byte.
    pub bits: u64,
    pub bit_count: u64,
}

/// Writes the codes for `symbols` from the last on, and the bits from the lowest up. It needs some room to spare.
#[inline(always)]
pub fn write_codes(
    symbols: &[u8],
    // By symbol: 1 to 12 of the highest bits, whose value is below 2048, and their number in the lowest 4.
    codes: &[u16; 256],
    out: &mut [u8],
) -> Option<Written> {
    let mut written = Written::default();
    // SAFETY: two slices, each as a pointer and a length.
    let is_done = unsafe {
        highway_zstd_write_codes(
            symbols.as_ptr(),
            symbols.len(),
            codes,
            out.as_mut_ptr(),
            out.len(),
            &mut written,
        )
    };
    is_done.then_some(written)
}

/// How often each byte occurs.
#[inline(always)]
pub fn count_bytes(bytes: &[u8]) -> Option<[u32; 256]> {
    let mut counts = [0; _];
    // SAFETY: a slice, as a pointer and a length.
    let is_done = unsafe { highway_zstd_count_bytes(bytes.as_ptr(), bytes.len(), &mut counts) };
    is_done.then_some(counts)
}
