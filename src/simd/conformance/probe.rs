//! Runs an instruction of each detected feature.
use crate::write_line;
use bun_simd::Target;
use core::arch::asm;

#[repr(align(64))]
struct Memory([u8; 1024]);

/// `= n` is the expected first register, for encodings that older CPUs run as another instruction.
macro_rules! probes {
    ($($name:literal: $($line:literal),+ $(= $result:literal)?;)*) => {
        /// SAFETY: the CPU has the feature.
        #[inline(never)]
        unsafe fn runs(feature: &str) -> bool {
            let memory = &mut Memory([0; 1024]);
            match feature {
                $($name => {
                    #[cfg_attr(target_arch = "aarch64", target_feature(enable = $name))]
                    #[inline(never)]
                    unsafe fn instruction_of_feature(memory: &mut Memory) -> u64 {
                        let (mut first, memory) = (1, memory.0.as_mut_ptr());
                        // SAFETY: changes no callee-saved register, and no memory but `memory`.
                        unsafe {
                            cfg_select! {
                                target_arch = "x86_64" => asm!(
                                    $($line),+,
                                    inout("rax") first,
                                    in("rdi") memory,
                                    clobber_abi("sysv64"),
                                ),
                                _ => asm!(
                                    $($line),+,
                                    inout("x0") first,
                                    in("x1") memory,
                                    clobber_abi("C"),
                                ),
                            }
                        };
                        first
                    }
                    // SAFETY: the caller's guarantee.
                    let _first = unsafe { instruction_of_feature(memory) };
                    true $(&& _first == $result)?
                })*
                _ => false,
            }
        }
    };
}

#[cfg(target_arch = "x86_64")]
probes! {
    "fxsr": "fxsave [rdi]";
    "sse": "addps xmm0, xmm1";
    "sse2": "paddq xmm0, xmm1";
    "sse3": "addsubps xmm0, xmm1";
    "ssse3": "pshufb xmm0, xmm1";
    "sse4.1": "pminud xmm0, xmm1";
    "sse4.2": "pcmpgtq xmm0, xmm1", "crc32 eax, eax";
    "sse4a": "extrq xmm0, 1, 1";
    "popcnt": "popcnt rax, rax";
    "lzcnt": "lzcnt rax, rax" = 63;
    "bmi1": "andn rcx, rax, rax", "tzcnt rax, rcx" = 64;
    "bmi2": "pdep rax, rax, rax";
    "tbm": "blcfill rax, rax";
    "adx": "adcx rax, rax";
    "movbe": "movbe rax, [rdi]";
    "cmpxchg16b": "lock cmpxchg16b [rdi]";
    "lahfsahf": "lahf";
    "prfchw": "prefetchw [rdi]";
    "clflushopt": "clflushopt [rdi]";
    "ermsb": "xor ecx, ecx", "rep stosb";
    "xsave": "xor edx, edx", "xsave [rdi]";
    "xsaveopt": "xor edx, edx", "xsaveopt [rdi]";
    "xsavec": "xor edx, edx", "xsavec [rdi]";
    "aes": "aesenc xmm0, xmm1";
    "pclmulqdq": "pclmulqdq xmm0, xmm1, 0";
    "sha": "sha1nexte xmm0, xmm1", "sha256msg1 xmm0, xmm1";
    "gfni": "gf2p8mulb xmm0, xmm1";
    "avx": "vaddps ymm0, ymm0, ymm1";
    "f16c": "vcvtph2ps ymm0, xmm1";
    "fma": "vfmadd231ps ymm0, ymm0, ymm1";
    "fma4": "vfmaddps ymm0, ymm0, ymm1, ymm2";
    "xop": "vpperm xmm0, xmm0, xmm1, xmm2";
    "sm3": "vsm3msg1 xmm0, xmm0, xmm1";
    "vpclmulqdq": "vpclmulqdq ymm0, ymm0, ymm1, 0";
    "avx2": "vpaddb ymm0, ymm0, ymm1";
    "vaes": "vaesenc ymm0, ymm0, ymm1";
    "sha512": "vsha512msg2 ymm0, ymm1";
    "sm4": "vsm4key4 ymm0, ymm0, ymm1";
    "avxvnni": "{{vex}} vpdpbusd ymm0, ymm0, ymm1";
    "avxifma": "{{vex}} vpmadd52luq ymm0, ymm0, ymm1";
    "avxvnniint8": "{{vex}} vpdpbssd ymm0, ymm0, ymm1";
    "avxneconvert": "vbcstnebf162ps ymm0, word ptr [rdi]";
    "avxvnniint16": "{{vex}} vpdpwsud ymm0, ymm0, ymm1";
    "avx512f": "vpaddd zmm16, zmm0, zmm1", "kmovw k1, eax";
    "avx512dq": "vpmullq zmm0, zmm0, zmm1";
    "avx512ifma": "vpmadd52luq zmm0, zmm0, zmm1";
    "avx512cd": "vpconflictd zmm0, zmm1";
    "avx512bw": "vpaddb zmm0, zmm0, zmm1", "kmovq k1, rax";
    "avx512vl": "vpternlogd ymm0, ymm0, ymm1, 1";
    "avx512vbmi": "vpermb zmm0, zmm0, zmm1";
    "avx512vbmi2": "vpcompressb zmm0, zmm1";
    "avx512vnni": "vpdpbusd zmm0, zmm0, zmm1";
    "avx512bitalg": "vpopcntb zmm0, zmm1";
    "avx512vpopcntdq": "vpopcntd zmm0, zmm1";
    "avx512vp2intersect": "vp2intersectd k2, zmm0, zmm1";
    "avx512fp16": "vaddph zmm0, zmm0, zmm1";
    "avx512bf16": "vdpbf16ps zmm0, zmm0, zmm1";
    "avx10.1": "vaddph zmm0, zmm0, zmm1";
    "avx10.2": "vminmaxps zmm0, zmm0, zmm1, 0";
}

#[cfg(target_arch = "aarch64")]
probes! {
    "neon": "add v0.16b, v0.16b, v1.16b";
    "crc": "crc32b w0, w0, w0";
    "lse": "ldadd x0, x0, [x1]";
    "lse2": "ldp x2, x3, [x1]";
    "lse128": "swpp x2, x3, [x1]";
    "rcpc": "ldapr x0, [x1]";
    "rcpc2": "ldapur x0, [x1, #8]";
    "rcpc3": "ldiapp x2, x3, [x1]";
    "flagm": "cfinv";
    "flagm2": "axflag";
    "cssc": "ctz x0, x0";
    "mops": "mov x2, #8", "setp [x1]!, x2!, x0", "setm [x1]!, x2!, x0", "sete [x1]!, x2!, x0";
    "hbc": "bc.eq 2f", "2:";
    "aes": "aese v0.16b, v1.16b", "pmull v0.1q, v0.1d, v1.1d";
    "sha2": "sha1h s0, s1", "sha256su0 v0.4s, v1.4s";
    "sha3": "eor3 v0.16b, v0.16b, v1.16b, v2.16b", "sha512su0 v0.2d, v1.2d";
    "sm4": "sm3partw1 v0.4s, v1.4s, v2.4s", "sm4e v0.4s, v1.4s";
    "rdm": "sqrdmlah v0.4s, v1.4s, v2.4s";
    "jsconv": "fjcvtzs w0, d0";
    "fcma": "fcadd v0.4s, v1.4s, v2.4s, #90";
    "dotprod": "udot v0.4s, v1.16b, v2.16b";
    "fp16": "fadd h0, h1, h2", "fadd v0.8h, v1.8h, v2.8h";
    "fhm": "fmlal v0.4s, v1.4h, v2.4h";
    "frintts": "frint32z v0.4s, v1.4s";
    "i8mm": "usdot v0.4s, v1.16b, v2.16b";
    "bf16": "bfdot v0.4s, v1.8h, v2.8h";
    "lut": "luti2 v0.16b, {{v1.16b}}, v2[0]";
    "faminmax": "famax v0.4s, v1.4s, v2.4s";
    "sve": "add z0.b, z0.b, z1.b";
    "f32mm": "fmmla z0.s, z1.s, z2.s";
    "sve2": "ptrue p0.b", "match p1.b, p0/z, z0.b, z1.b";
    "sve2p1": "addqv v0.16b, p0, z1.b";
    "sve2-aes": "aese z0.b, z0.b, z1.b", "pmullb z0.q, z1.d, z2.d";
    "sve2-bitperm": "bext z0.b, z1.b, z2.b";
    "sve2-sha3": "rax1 z0.d, z1.d, z2.d";
    "sve2-sm4": "sm4e z0.s, z0.s, z1.s";
}

/// If the process dies, the last line names the feature.
pub(crate) fn run() -> bool {
    for target in Target::ALL.iter().filter(|target| target.is_supported()) {
        write_line(format_args!("target: {}", target.name()));
    }
    bun_simd::detected().names().all(|feature| {
        write_line(format_args!("feature: {feature}"));
        // SAFETY: the feature was detected, which is what this tests.
        unsafe { runs(feature) }
    })
}
