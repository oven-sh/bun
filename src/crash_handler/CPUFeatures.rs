use core::ffi::c_void as _; // (no c types needed; kept for FFI clarity)
use core::fmt;

// TODO(port): move to crash_handler_sys
unsafe extern "C" {
    safe fn bun_cpu_features() -> u8;
}

#[derive(Copy, Clone)]
pub struct CPUFeatures {
    pub flags: Flags,
}

// Zig: `packed struct(u8)` per-arch. All semantic fields are `bool`; the trailing
// `padding: uN = 0` is unused bits. bitflags! models this directly (unknown bits
// = padding). Bit order matches Zig packed-struct LSB-first layout.
// PORT NOTE: guide says "bitflags! if every field is bool" — padding is uN, but
// it is pure padding, so bitflags is the correct shape here.

#[cfg(target_arch = "x86_64")]
bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Copy, Clone)]
    pub struct Flags: u8 {
        const NONE   = 1 << 0;
        const SSE42  = 1 << 1;
        const POPCNT = 1 << 2;
        const AVX    = 1 << 3;
        const AVX2   = 1 << 4;
        const AVX512 = 1 << 5;
        // bits 6..=7 = padding
    }
}

#[cfg(target_arch = "aarch64")]
bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Copy, Clone)]
    pub struct Flags: u8 {
        const NONE    = 1 << 0;
        const NEON    = 1 << 1;
        const FP      = 1 << 2;
        const AES     = 1 << 3;
        const CRC32   = 1 << 4;
        const ATOMICS = 1 << 5;
        const SVE     = 1 << 6;
        // bit 7 = padding
    }
}

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
compile_error!("CPUFeatures: unsupported target architecture");

// Zig `inline for (@typeInfo(Flags).@"struct".fields)` — comptime reflection over
// field names, skipping "none" and "padding". Expanded to a const table per arch.
#[cfg(target_arch = "x86_64")]
const NAMED_FLAGS: &[(&str, Flags)] = &[
    ("sse42", Flags::SSE42),
    ("popcnt", Flags::POPCNT),
    ("avx", Flags::AVX),
    ("avx2", Flags::AVX2),
    ("avx512", Flags::AVX512),
];

#[cfg(target_arch = "aarch64")]
const NAMED_FLAGS: &[(&str, Flags)] = &[
    ("neon", Flags::NEON),
    ("fp", Flags::FP),
    ("aes", Flags::AES),
    ("crc32", Flags::CRC32),
    ("atomics", Flags::ATOMICS),
    ("sve", Flags::SVE),
];

impl fmt::Display for CPUFeatures {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut is_first = true;
        for &(name, bit) in NAMED_FLAGS {
            if self.flags.contains(bit) {
                if !is_first {
                    f.write_str(" ")?;
                }
                is_first = false;
                f.write_str(name)?;
            }
        }
        Ok(())
    }
}

impl CPUFeatures {
    pub fn is_empty(self) -> bool {
        self.flags.bits() == 0
    }

    #[cfg(target_arch = "x86_64")]
    pub fn has_any_avx(self) -> bool {
        self.flags.contains(Flags::AVX)
            || self.flags.contains(Flags::AVX2)
            || self.flags.contains(Flags::AVX512)
    }

    pub fn get() -> CPUFeatures {
        let raw = bun_cpu_features();
        let flags = Flags::from_bits_retain(raw);
        // sanity check: `none` bit clear and no padding bits set
        debug_assert!(!flags.contains(Flags::NONE) && (raw & !Flags::all().bits()) == 0);

        #[cfg(target_arch = "x86_64")]
        {
            // Zig: bun.analytics.Features.no_avx / no_avx2 are global mutable
            // counters (`+= usize`). Rust port stores them as `AtomicUsize`.
            use core::sync::atomic::Ordering;
            bun_analytics::features::no_avx
                .fetch_add(usize::from(!flags.contains(Flags::AVX)), Ordering::Relaxed);
            bun_analytics::features::no_avx2
                .fetch_add(usize::from(!flags.contains(Flags::AVX2)), Ordering::Relaxed);
        }

        CPUFeatures { flags }
    }
}

// ported from: src/crash_handler/CPUFeatures.zig
