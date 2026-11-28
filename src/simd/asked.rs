//! Instructions that no level has, as few CPUs run them fast. An operation asks for them at each call.
#![deny(asm_sub_register)]

#[allow(unused_macros)]
macro_rules! run { ($($all:tt)*) => {
    // SAFETY: `self` comes from `here`. The instruction writes the results only, after it has read the operands.
    #[allow(unsafe_code)]
    unsafe { core::arch::asm!($($all)*, options(nomem, nostack, preserves_flags)) }
}; }

/// The CPU has `bext` and `bdep`.
#[derive(Copy, Clone)]
pub(crate) struct BitPerm(());

cfg_select! {
    // The systems of servers that tell the model and have SVE.
    all(
        target_arch = "aarch64",
        target_feature = "neon",
        target_endian = "little",
        any(target_os = "linux", target_os = "freebsd"),
        not(miri)
    ) => {
        use crate::{Named, Target};
        use core::arch::aarch64::uint8x16_t;

        /// As in sve.rs. A lane of the result depends on the same lane of the operands.
        macro_rules! lanes { ($deposit:expr, $t:literal, $v:ident, $mask:ident) => {{
            macro_rules! of { ($op:literal) => {{
                let all;
                run!(".arch_extension sve2-bitperm", ".irp r,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31", r"zq\r .req z\r", ".endr",
                    concat!($op, " z{all:q}", $t, ", z{v:q}", $t, ", z{mask:q}", $t), v = in(vreg) $v, mask = in(vreg) $mask, all = lateout(vreg) all);
                all
            }}; }
            if $deposit { of!("bdep") } else { of!("bext") }
        }}; }

        impl BitPerm {
            /// The error tells whether this is known.
            #[inline(always)]
            pub(crate) fn here() -> Result<Self, bool> {
                match crate::gate::is_here(const { Target::of(Named::Portable, &["sve2-bitperm", "fast_pdep"]) }) {
                    Some(true) => Ok(Self(())),
                    other => Err(other.is_some()),
                }
            }
            #[inline(always)]
            pub(crate) fn number(self, v: u64, mask: u64, deposit: bool) -> u64 {
                lanes!(deposit, ".d", v, mask)
            }
            #[inline(always)]
            pub(crate) fn lanes(self, v: uint8x16_t, mask: uint8x16_t, bits: u32, deposit: bool) -> uint8x16_t {
                match bits {
                    8 => lanes!(deposit, ".b", v, mask),
                    16 => lanes!(deposit, ".h", v, mask),
                    32 => lanes!(deposit, ".s", v, mask),
                    _ => lanes!(deposit, ".d", v, mask),
                }
            }
        }
    }
    _ => {
        impl BitPerm {
            #[inline(always)]
            pub(crate) fn here() -> Result<Self, bool> {
                Err(true)
            }
            pub(crate) fn number(self, v: u64, _: u64, _: bool) -> u64 {
                v
            }
            pub(crate) fn lanes<V>(self, v: V, _: V, _: u32, _: bool) -> V {
                v
            }
        }
    }
}

/// The CPU has `vp2intersect`.
#[derive(Copy, Clone)]
pub(crate) struct Intersect(());

cfg_select! {
    all(
        any(target_arch = "x86", target_arch = "x86_64"),
        target_feature = "sse2",
        not(any(target_vendor = "apple", miri))
    ) => {
        use crate::{Named, Target, simd::u8x64};

        impl Intersect {
            #[inline(always)]
            pub(crate) fn here() -> Option<Self> {
                (cfg!(target_feature = "avx512vp2intersect")
                    || crate::gate::is_here(const { Target::of(Named::Portable, &["avx512vp2intersect"]) })?)
                .then_some(Self(()))
            }
            /// A bit for each lane of 32 bits of `v`: whether `set` has it.
            #[inline]
            #[target_feature(enable = "avx512f")]
            pub(crate) fn members(self, v: u8x64, set: u8x64) -> u16 {
                let found;
                run!("vp2intersectd k6, {}, {}", in(zmm_reg) v.0, in(zmm_reg) set.0, lateout("k6") found, lateout("k7") _);
                found
            }
        }
    }
    _ => {
        impl Intersect {
            #[inline(always)]
            pub(crate) fn here() -> Option<Self> {
                None
            }
            pub(crate) fn members<V>(self, _: V, _: V) -> u16 {
                0
            }
        }
    }
}
