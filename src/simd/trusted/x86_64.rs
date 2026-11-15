//! From what `cpuid` and the system say to features. Asks nothing itself.

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
    /// Not a register: bit `n` says that the version of AVX10 is `n` or later.
    Avx10,
}
use Register::*;

/// The bits of XCR0 for the registers that the system has to save.
const XMM_YMM: u64 = 0b110;
const MASKS_ZMM: u64 = 0b1110_0000;

features! { "x86_64", (Register, u8);
    "fxsr" = (L1d, 24);
    "sse" = (L1d, 25);
    "sse2" ("sse") = (L1d, 26);
    "sse3" ("sse2") = (L1c, 0);
    "ssse3" ("sse3") = (L1c, 9);
    "sse4.1" ("ssse3") = (L1c, 19);
    "sse4.2" ("sse4.1") = (L1c, 20);
    "sse4a" ("sse3") = (E1c, 6);
    "popcnt" = (L1c, 23);
    "lzcnt" = (E1c, 5);
    "bmi1" = (L7b, 3);
    "bmi2" = (L7b, 8);
    "tbm" = (E1c, 21);
    "adx" = (L7b, 19);
    "movbe" = (L1c, 22);
    "cmpxchg16b" = (L1c, 13);
    "lahfsahf" = (E1c, 0);
    "prfchw" = (E1c, 8);
    "clflushopt" = (L7b, 23);
    "ermsb" = (L7b, 9);
    "xsave" = (L1c, 27);
    "xsaveopt" ("xsave") = (LDa, 0);
    "xsavec" ("xsave") = (LDa, 1);
    "aes" ("sse2") = (L1c, 25);
    "pclmulqdq" ("sse2") = (L1c, 1);
    "sha" ("sse2") = (L7b, 29);
    "gfni" ("sse2") = (L7c, 8);
    "avx" ("sse4.2", "xsave") = (L1c, 28);
    "f16c" ("avx") = (L1c, 29);
    "fma" ("avx") = (L1c, 12);
    "fma4" ("avx", "sse4a") = (E1c, 16);
    "xop" ("fma4") = (E1c, 11);
    "sm3" ("avx") = (L71a, 1);
    "vpclmulqdq" ("avx", "pclmulqdq") = (L7c, 10);
    "avx2" ("avx") = (L7b, 5);
    "vaes" ("avx2", "aes") = (L7c, 9);
    "sha512" ("avx2") = (L71a, 0);
    "sm4" ("avx2") = (L71a, 2);
    "avxvnni" ("avx2") = (L71a, 4);
    "avxifma" ("avx2") = (L71a, 23);
    "avxvnniint8" ("avx2") = (L71d, 4);
    "avxneconvert" ("avx2") = (L71d, 5);
    "avxvnniint16" ("avx2") = (L71d, 10);
    "avx512f" ("avx2", "f16c", "fma") = (L7b, 16);
    "avx512dq" ("avx512f") = (L7b, 17);
    "avx512ifma" ("avx512f") = (L7b, 21);
    "avx512cd" ("avx512f") = (L7b, 28);
    "avx512bw" ("avx512f") = (L7b, 30);
    "avx512vl" ("avx512f") = (L7b, 31);
    "avx512vbmi" ("avx512bw") = (L7c, 1);
    "avx512vbmi2" ("avx512bw") = (L7c, 6);
    "avx512vnni" ("avx512f") = (L7c, 11);
    "avx512bitalg" ("avx512bw") = (L7c, 12);
    "avx512vpopcntdq" ("avx512f") = (L7c, 14);
    "avx512vp2intersect" ("avx512f") = (L7d, 8);
    "avx512fp16" ("avx512bw") = (L7d, 23);
    "avx512bf16" ("avx512bw") = (L71a, 5);
    "avx10.1" (
        "avx512bf16", "avx512bitalg", "avx512cd", "avx512dq", "avx512fp16", "avx512ifma",
        "avx512vbmi", "avx512vbmi2", "avx512vl", "avx512vnni", "avx512vpopcntdq"
    ) = (Avx10, 1);
    "avx10.2" ("avx10.1", "avxvnni", "avxvnniint8", "avxvnniint16") = (Avx10, 2);
}

/// `cpuid(leaf, subleaf)` is `[eax, ebx, ecx, edx]`. `saved` is what can be relied on of XCR0.
pub fn decode(cpuid: impl Fn(u32, u32) -> [u32; 4], saved: u64) -> Features {
    // Above the last leaf there is, the answer is that of another one.
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
        // Reserved, and no promise that they stay 0.
        registers[E1c as usize] &= !(1 << 6 | 1 << 21);
        // Erratum SKL052: Pentiums and Celerons without AVX report BMI1 and BMI2, which they lack.
        if l1[2] >> 28 & 1 == 0 {
            registers[L7b as usize] &= !(1 << 3 | 1 << 8);
        }
    }
    // The table has the bit of the system, OSXSAVE. This is the one of the CPU.
    if l1[2] >> 26 & 1 == 0 {
        registers[L1c as usize] &= !(1 << 27);
    }
    if saved & XMM_YMM != XMM_YMM {
        registers[L1c as usize] &= !(1 << 28);
    }
    if saved & MASKS_ZMM != MASKS_ZMM {
        registers[L7b as usize] &= !(1 << 16);
    }
    Features::reported(|&(register, bit)| registers[register as usize] >> bit & 1 != 0)
}

/// macOS sets the bits for AVX-512 in a thread only once it has run such an instruction.
pub fn saved_by_darwin(xcr0: u64, has_avx512f: bool, release: &[u8]) -> u64 {
    let mut numbers = release
        .split(|&b| b == b'.')
        .map(|n| str::from_utf8(n).ok()?.parse::<u32>().ok());
    let release = numbers.next().flatten().zip(numbers.next().flatten());
    // Signal handlers lost the masks before: https://github.com/golang/go/issues/49233
    if has_avx512f && release >= Some((21, 3)) {
        xcr0 | MASKS_ZMM
    } else {
        xcr0 & !MASKS_ZMM
    }
}
