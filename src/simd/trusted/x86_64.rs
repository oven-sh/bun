//! Decodes the answers of `cpuid` and `xgetbv`.
use crate::features::{Arch, Feature, major_and_minor, row};

/// Leaf, subleaf if not 0, register. `E` is for the extended leaves.
#[derive(Clone, Copy)]
enum Register {
    L1c,
    L1d,
    L7b,
    L7c,
    L7d,
    L71a,
    L71d,
    LDa,
    E1c,
    /// Not a register: bit `n` is set if the version of AVX10 is at least `n`.
    Avx10,
}
use Register::*;

/// The bits of XCR0 for the registers that the system has to save.
const XMM_YMM: u64 = 0b110;
const MASKS_ZMM: u64 = 0b1110_0000;

pub struct Bit(Register, u8);

pub struct X86_64;

pub type Features = crate::features::Features<X86_64>;

impl Arch for X86_64 {
    type Source = Bit;

    #[rustfmt::skip]
    const FEATURES: &'static [Feature<Bit>] = &[
        row!("fxsr", [], Bit(L1d, 24)),
        row!("sse", [], Bit(L1d, 25)),
        row!("sse2", ["sse"], Bit(L1d, 26)),
        row!("sse3", ["sse2"], Bit(L1c, 0)),
        row!("ssse3", ["sse3"], Bit(L1c, 9)),
        row!("sse4.1", ["ssse3"], Bit(L1c, 19)),
        row!("sse4.2", ["sse4.1"], Bit(L1c, 20)),
        row!("sse4a", ["sse3"], Bit(E1c, 6)),
        row!("popcnt", [], Bit(L1c, 23)),
        row!("lzcnt", [], Bit(E1c, 5)),
        row!("bmi1", [], Bit(L7b, 3)),
        row!("bmi2", [], Bit(L7b, 8)),
        row!("tbm", [], Bit(E1c, 21)),
        row!("adx", [], Bit(L7b, 19)),
        row!("movbe", [], Bit(L1c, 22)),
        row!("cmpxchg16b", [], Bit(L1c, 13)),
        row!("lahfsahf", [], Bit(E1c, 0)),
        row!("prfchw", [], Bit(E1c, 8)),
        row!("clflushopt", [], Bit(L7b, 23)),
        row!("ermsb", [], Bit(L7b, 9)),
        row!("xsave", [], Bit(L1c, 27)),
        row!("xsaveopt", ["xsave"], Bit(LDa, 0)),
        row!("xsavec", ["xsave"], Bit(LDa, 1)),
        row!("aes", ["sse2"], Bit(L1c, 25)),
        row!("pclmulqdq", ["sse2"], Bit(L1c, 1)),
        row!("sha", ["sse2"], Bit(L7b, 29)),
        row!("gfni", ["sse2"], Bit(L7c, 8)),
        row!("avx", ["sse4.2", "xsave"], Bit(L1c, 28)),
        row!("f16c", ["avx"], Bit(L1c, 29)),
        row!("fma", ["avx"], Bit(L1c, 12)),
        row!("fma4", ["avx", "sse4a"], Bit(E1c, 16)),
        row!("xop", ["fma4"], Bit(E1c, 11)),
        row!("sm3", ["avx"], Bit(L71a, 1)),
        row!("vpclmulqdq", ["avx", "pclmulqdq"], Bit(L7c, 10)),
        row!("avx2", ["avx"], Bit(L7b, 5)),
        row!("vaes", ["avx2", "aes"], Bit(L7c, 9)),
        row!("sha512", ["avx2"], Bit(L71a, 0)),
        row!("sm4", ["avx2"], Bit(L71a, 2)),
        row!("avxvnni", ["avx2"], Bit(L71a, 4)),
        row!("avxifma", ["avx2"], Bit(L71a, 23)),
        row!("avxvnniint8", ["avx2"], Bit(L71d, 4)),
        row!("avxneconvert", ["avx2"], Bit(L71d, 5)),
        row!("avxvnniint16", ["avx2"], Bit(L71d, 10)),
        row!("avx512f", ["avx2", "f16c", "fma"], Bit(L7b, 16)),
        row!("avx512dq", ["avx512f"], Bit(L7b, 17)),
        row!("avx512ifma", ["avx512f"], Bit(L7b, 21)),
        row!("avx512cd", ["avx512f"], Bit(L7b, 28)),
        row!("avx512bw", ["avx512f"], Bit(L7b, 30)),
        row!("avx512vl", ["avx512f"], Bit(L7b, 31)),
        row!("avx512vbmi", ["avx512bw"], Bit(L7c, 1)),
        row!("avx512vbmi2", ["avx512bw"], Bit(L7c, 6)),
        row!("avx512vnni", ["avx512f"], Bit(L7c, 11)),
        row!("avx512bitalg", ["avx512bw"], Bit(L7c, 12)),
        row!("avx512vpopcntdq", ["avx512f"], Bit(L7c, 14)),
        row!("avx512vp2intersect", ["avx512f"], Bit(L7d, 8)),
        row!("avx512fp16", ["avx512bw"], Bit(L7d, 23)),
        row!("avx512bf16", ["avx512bw"], Bit(L71a, 5)),
        row!("avx10.1", [
            "avx512bf16", "avx512bitalg", "avx512cd", "avx512dq", "avx512fp16", "avx512ifma",
            "avx512vbmi", "avx512vbmi2", "avx512vl", "avx512vnni", "avx512vpopcntdq",
        ], Bit(Avx10, 1)),
        row!("avx10.2", ["avx10.1", "avxvnni", "avxvnniint8", "avxvnniint16"], Bit(Avx10, 2)),
    ];
}

/// `cpuid(leaf, subleaf)` is `[eax, ebx, ecx, edx]`. `saved` has the reliable bits of XCR0.
pub fn decode(cpuid: impl Fn(u32, u32) -> [u32; 4], saved: u64) -> Features {
    // A leaf above the last one returns the data of another leaf.
    let up_to = |last: u32, leaf: u32, subleaf: u32| {
        if leaf <= last {
            cpuid(leaf, subleaf)
        } else {
            [0; 4]
        }
    };
    let [last, vendor @ ..] = cpuid(0, 0);
    let (l1, l7) = (up_to(last, 1, 0), up_to(last, 7, 0));
    let l71 = if l7[0] >= 1 { cpuid(7, 1) } else { [0; 4] };
    let [last_extended, ..] = cpuid(0x8000_0000, 0);
    let e1 = if last_extended >> 16 == 0x8000 {
        up_to(last_extended, 0x8000_0001, 0)
    } else {
        [0; 4]
    };
    let l24 = if l71[3] >> 19 & 1 != 0 {
        up_to(last, 0x24, 0)
    } else {
        [0; 4]
    };
    let avx10 = if l24[1] >> 18 & 1 != 0 {
        (2 << (l24[1] & 0xFF).min(2)) - 1
    } else {
        0
    };

    let mut registers = [
        l1[2],
        l1[3],
        l7[1],
        l7[2],
        l7[3],
        l71[0],
        l71[3],
        up_to(last, 0xD, 1)[0],
        e1[2],
        avx10,
    ];
    if vendor.map(u32::to_le_bytes).as_flattened() == b"GenuntelineI" {
        // Reserved bits, which need not be 0.
        registers[E1c as usize] &= !(1 << 6 | 1 << 21);
        // Erratum SKL052: Pentiums and Celerons without AVX report BMI1 and BMI2, which they lack.
        if l1[2] >> 28 & 1 == 0 {
            registers[L7b as usize] &= !(1 << 3 | 1 << 8);
        }
    }
    // The table checks OSXSAVE. This checks XSAVE.
    if l1[2] >> 26 & 1 == 0 {
        registers[L1c as usize] &= !(1 << 27);
    }
    if saved & XMM_YMM != XMM_YMM {
        registers[L1c as usize] &= !(1 << 28);
    }
    if saved & MASKS_ZMM != MASKS_ZMM {
        registers[L7b as usize] &= !(1 << 16);
    }
    Features::reported(|&Bit(register, bit)| registers[register as usize] >> bit & 1 != 0)
}

/// macOS sets the AVX-512 bits for a thread only after its first AVX-512 instruction.
pub fn saved_by_darwin(xcr0: u64, has_avx512f: bool, release: &[u8]) -> u64 {
    // Earlier releases lose the mask registers in signal handlers: https://github.com/golang/go/issues/49233
    if has_avx512f && major_and_minor(release) >= Some((21, 3)) {
        xcr0 | MASKS_ZMM
    } else {
        xcr0 & !MASKS_ZMM
    }
}
