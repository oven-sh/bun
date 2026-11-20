//! The kernels of `bun_zstd_encoder`, from src/jsc/bindings/highway_zstd.cpp. On most CPUs, they leave the work to the caller.

#[derive(Default)]
#[repr(C)]
pub struct Written {
    /// In bytes.
    pub len: u64,
    /// Those that do not fill a byte.
    pub bits: u64,
    pub bit_count: u64,
}

cfg_select! {
    feature = "test_support" => {
        std::thread_local! {
            /// From how many on this thread gets what stands in for the kernels.
            pub static COUNT_MIN: core::cell::Cell<usize> = const { core::cell::Cell::new(usize::MAX) };
        }

        pub fn are_quicker_for(count: usize) -> bool {
            count >= COUNT_MIN.get()
        }

        pub fn write_codes(symbols: &[u8], codes: &[u16; 256], out: &mut [u8]) -> Option<Written> {
            let (mut len, mut bits, mut bit_count) = (0, 0, 0);
            for group in symbols.chunks(64).rev() {
                out.get_mut(len..len + 128)?.fill(0xAA);
                for &symbol in group.iter().rev() {
                    let code = u64::from(codes[usize::from(symbol)]);
                    let value = code >> (16 - code % 16);
                    assert!((1..=12).contains(&(code % 16)) && value < 2048);
                    bits |= value << bit_count;
                    bit_count += code % 16;
                    while bit_count >= 8 {
                        out[len] = bits as u8;
                        (len, bits, bit_count) = (len + 1, bits >> 8, bit_count - 8);
                    }
                }
            }
            Some(Written {
                len: len as u64,
                bits,
                bit_count,
            })
        }

        /// Refuses odd lengths.
        pub fn count_bytes(bytes: &[u8]) -> Option<[u32; 256]> {
            let mut counts = [0; _];
            for &byte in bytes {
                counts[usize::from(byte)] += 1;
            }
            bytes.len().is_multiple_of(2).then_some(counts)
        }
    }
    all(target_arch = "x86_64", not(miri)) => {
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

        /// From Zen 4 and Sapphire Rapids on. Ice Lake and its like, whose clock goes down for vectors of 512 bits, have no BF16.
        #[unsafe(no_mangle)]
        extern "C" fn highway_zstd_is_quicker() -> bool {
            is_x86_feature_detected!("avx512vbmi2") && is_x86_feature_detected!("avx512bf16")
        }

        #[inline(always)]
        pub fn are_quicker_for(count: usize) -> bool {
            /// After a pause, Intel's cores take 2 microseconds to get ready for them.
            const COUNT_MIN: usize = 4096;
            count >= COUNT_MIN && highway_zstd_is_quicker()
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
            let is_done =
                unsafe { highway_zstd_count_bytes(bytes.as_ptr(), bytes.len(), &mut counts) };
            is_done.then_some(counts)
        }
    }
    _ => {
        #[inline(always)]
        pub fn are_quicker_for(_: usize) -> bool {
            false
        }

        pub fn write_codes(_: &[u8], _: &[u16; 256], _: &mut [u8]) -> Option<Written> {
            None
        }

        pub fn count_bytes(_: &[u8]) -> Option<[u32; 256]> {
            None
        }
    }
}
