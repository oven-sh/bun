//! AArch64 baseline verification by raw encoding-pattern matching.
//!
//! Unlike x64, ARM64 has fixed-width 32-bit instructions and a dense,
//! well-partitioned encoding space. We don't need a disassembler: iterating
//! u32 words over .text and checking a handful of bit-masks is exact.
//!
//! Target: `armv8-a+crc` (Cortex-A53), matching cmake/CompilerFlags.cmake:29
//! (`-march=armv8-a+crc`) and verify-baseline.ts's QEMU `-cpu cortex-a53`.
//!
//! All masks below were derived empirically by assembling a fixture with each
//! instruction class and cross-referencing the ARM Architecture Reference
//! Manual (DDI 0487). See the inline comments for the bit-field breakdown.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Feature {
    /// Large System Extensions (ARMv8.1-A). CAS, CASP, SWP, LDADD/LDCLR/LDEOR/
    /// LDSET/LD{S,U}{MAX,MIN} and their ST* store-only variants. By far the
    /// most likely accidental hit: compilers emit inline CAS for atomics when
    /// `-march=armv8.1-a` or higher leaks through; with `-march=armv8-a` you
    /// get `__aarch64_cas*` outline helpers (libgcc/compiler-rt) that dispatch
    /// at runtime via AT_HWCAP.
    Lse,
    /// Scalable Vector Extension (ARMv8.2-A+). The entire op0=0010 encoding
    /// space is reserved for SVE — one mask catches all of it.
    Sve,
    /// RCPC (ARMv8.3-A). LDAPR weak-acquire loads. Rare in practice; emitted
    /// by Rust with `-C target-feature=+rcpc` or certain C++ atomics.
    Rcpc,
    /// DotProd (ARMv8.2-A optional). SDOT/UDOT i8→i32 accumulate. ML kernels.
    DotProd,
    /// JSCVT (ARMv8.3-A). FJCVTZS: JavaScript-semantics double-to-int32
    /// truncation. Watch this one — JSC's JIT uses it when available and the
    /// MacroAssembler may have a stub.
    Jscvt,
    /// RDM (ARMv8.1-A). SQRDMLAH/SQRDMLSH. DSP fixed-point stuff, unlikely.
    Rdm,
    /// Non-hint pointer authentication (ARMv8.3-A). LDRAA/LDRAB load with an
    /// embedded PAC check. Unlike PACIASP/AUTIASP/BTI (which are HINT-space
    /// and NOP on older CPUs by design), these *fault* on non-PAC hardware.
    PacNonHint,
}

impl Feature {
    pub fn name(self) -> &'static str {
        match self {
            Feature::Lse => "LSE",
            Feature::Sve => "SVE",
            Feature::Rcpc => "RCPC",
            Feature::DotProd => "DotProd",
            Feature::Jscvt => "JSCVT",
            Feature::Rdm => "RDM",
            Feature::PacNonHint => "PAC(non-hint)",
        }
    }
}

/// Classify one 32-bit instruction word. Returns None if it's within
/// armv8-a+crc, Some(feature) if it requires something newer.
///
/// Check order is roughly by expected frequency (most SVE words are bulk
/// data-plane code, so cheap to bail on early; LSE leaks are next most
/// likely).
pub fn classify(w: u32) -> Option<Feature> {
    // ---- SVE ----
    // ARM ARM top-level decode: op0[28:25]=0010 is the SVE encoding space.
    // Nothing in ARMv8.0-A occupies it. One mask, exact.
    //   ptrue p0.b         : 2518e3e0 & 1E000000 = 04000000  ✓
    //   ld1b {z0.b}, p0/z  : a400a000 & 1E000000 = 04000000  ✓
    //   add  z0.b,z0.b,z1.b: 04210000 & 1E000000 = 04000000  ✓
    //   ldxr (v8.0)        : c85f7c20 & 1E000000 = 08000000  ✗
    //   addv (NEON, v8.0)  : 4eb1b820 & 1E000000 = 0e000000  ✗
    if w & 0x1E000000 == 0x04000000 {
        return Some(Feature::Sve);
    }

    // ---- LSE: CAS / CASP family ----
    // CAS:  size[31:30] 001000[29:24] 1[23]    L[22] 1[21] Rs 11111[14:10] Rn Rt
    // CASP: 0[31] sz[30] 001000[29:24] L[23] 0[22] 1[21] Rs 11111[14:10] Rn Rt
    //
    // v8.0's STXP/STLXP/LDXP/LDAXP share [29:24]=001000, [21]=1, and when
    // their Rt2 field is XZR (register 31) they also have [14:10]=11111.
    // Observed colliding in the wild: `stxp w9, xzr, xzr, [x8]` = c8297d1f
    // inside libpas. The disambiguator from the ARM ARM:
    //   - CAS  has [23]=1 fixed   (the L bit is at [22])
    //   - CASP has [31]=0 fixed   (CASP is 32/64-bit only, no byte/half)
    //   - STXP/LDXP have [31]=1 AND [23]=0
    // So: LSE iff NOT ([31]=1 AND [23]=0).
    //   cas   : c8a07c41 [31]=1 [23]=1 ✓   casal : 88e0fc41 [31]=1 [23]=1 ✓
    //   casb  : 08a07c41 [31]=0         ✓   casp  : 48207c82 [31]=0       ✓
    //   stxp  : c8297d1f [31]=1 [23]=0 ✗ (v8.0, correctly excluded)
    //   ldxr  : c85f7c20 [21]=0, outer mask excludes
    if w & 0x3F207C00 == 0x08207C00 {
        let is_v80_exclusive_pair = (w & 0x80000000) != 0 && (w & 0x00800000) == 0;
        if !is_v80_exclusive_pair {
            return Some(Feature::Lse);
        }
    }

    // ---- LSE: atomic memory ops (LDADD/LDCLR/LDEOR/LDSET/LD{S,U}{MAX,MIN}/SWP) ----
    // Encoding: size[31:30] 111[29:27] V[26]=0 00[25:24] A[23] R[22] 1[21]
    //           Rs[20:16] o3[15] opc[14:12] 00[11:10] Rn Rt
    // Fix [29:27]=111, [26]=0, [25:24]=00, [21]=1, [11:10]=00.
    //
    // RCPC's LDAPR lives in the *same* encoding group (it's the o3=1 opc=100
    // Rs=11111 corner). Both are post-v8.0 so matching both is correct; we
    // sub-classify for the report.
    //   swp   : f8208041  ldadd : f8200041  stadd : f820003f  ldapr : f8bfc020
    //   ldraa (PAC, must NOT match): f8200420 → [10]=1, excluded
    //   ldaprb:                      38bfc020 → size differs but pattern holds
    if w & 0x3F200C00 == 0x38200000 {
        // RCPC sub-match: Rs=11111, o3=1, opc=100 (bits [20:12]=0xBFC >> 2).
        if w & 0x001FFC00 == 0x001FC000 {
            return Some(Feature::Rcpc);
        }
        return Some(Feature::Lse);
    }

    // ---- LDRAA / LDRAB (PAC non-hint loads) ----
    // Encoding: 11111000[31:24] M[23] S[22] 1[21] imm9[20:12] W[11] 1[10] Rn Rt
    // Fix [31:24], [21], [10]. M (key A/B), S, imm9, W free.
    //   ldraa : f8200420  ldrab (pre-index): f8a00c20
    //   ldadd (must NOT match): f8200041 → [10]=0, excluded
    // Must come *after* the LSE atomic check because the LSE mask is strictly
    // more specific on [11:10]=00 — they can't both match the same word.
    if w & 0xFF200400 == 0xF8200400 {
        return Some(Feature::PacNonHint);
    }

    // ---- DotProd: SDOT/UDOT (vector, by-vector form) ----
    // Encoding: 0[31] Q[30] U[29] 01110[28:24] 10[23:22] 0[21] Rm 100101[15:10] Rn Rd
    // Fix [28:24]=01110, [23:22]=10, [21]=0, [15:10]=100101. Q and U free.
    //   sdot : 4e829420  udot : 6e829420
    //   addv (NEON, must NOT match): 4eb1b820 → size and opc differ
    //   sqrdmlah (RDM, must NOT match): 6e828420 → [12]=0 here, [12]=1 for DOT
    if w & 0x9FE0FC00 == 0x0E809400 {
        return Some(Feature::DotProd);
    }
    // By-element form: 0 Q U 01111 size L M Rm 1110 H 0 Rn Rd with size=10.
    // Only the size=10 variant is DotProd; other sizes are pre-existing SQDMLAL etc.
    //   (not in the fixture; derived from ARM ARM table C4-312)
    if w & 0x9FC0F400 == 0x0F80E000 {
        return Some(Feature::DotProd);
    }

    // ---- RDM: SQRDMLAH/SQRDMLSH (vector) ----
    // Encoding: 0 Q 1 01110 size 0 Rm 1000 S 1 Rn Rd
    // Fix [29]=1, [28:24]=01110, [21]=0, [15:12]=1000, [10]=1. Q, size, S free.
    //   sqrdmlah : 6e828420  sqrdmlsh : 6e828c20
    if w & 0xBF20F400 == 0x2E008400 {
        return Some(Feature::Rdm);
    }

    // ---- JSCVT: FJCVTZS ----
    // Single encoding: 0001 1110 0111 1110 0000 00 Rn Rd.
    //   fjcvtzs : 1e7e0020
    if w & 0xFFFFFC00 == 0x1E7E0000 {
        return Some(Feature::Jscvt);
    }

    // Deliberately NOT matched:
    //   - PACIASP/AUTIASP/BTI and other hint-form PAC: HINT-space (d503xxxx),
    //     architecturally defined to NOP on CPUs that don't recognize the
    //     specific op2:CRm. Safe everywhere.
    //   - ARMv8 Crypto Extension (AESE/AESD/SHA1*/SHA256*/PMULL): post-baseline
    //     (+aes/+sha2 not in armv8-a+crc). Every known emitter (BoringSSL) is
    //     runtime-dispatched via getauxval(AT_HWCAP). Add a Feature::Crypto
    //     variant if an unconditional use ever shows up.
    //   - FP16 arithmetic: genuinely post-v8.0 but the encoding overlaps the
    //     NEON space in a way that requires tracking the `size` field across
    //     many opcode families. Deferred until it shows up in a real scan.

    None
}

/// Best-effort mnemonic for the report. Not a disassembler — just enough to
/// let a developer recognize what they're looking at without reaching for
/// objdump. If unsure, fall back to the Feature name.
pub fn rough_mnemonic(w: u32, feat: Feature) -> &'static str {
    match feat {
        Feature::Sve => "<sve>",
        Feature::Rcpc => "ldapr",
        Feature::Jscvt => "fjcvtzs",
        Feature::PacNonHint => {
            if w & 0x00800000 != 0 {
                "ldrab"
            } else {
                "ldraa"
            }
        }
        Feature::DotProd => {
            if w & 0x20000000 != 0 {
                "udot"
            } else {
                "sdot"
            }
        }
        Feature::Rdm => {
            if w & 0x00000800 != 0 {
                "sqrdmlsh"
            } else {
                "sqrdmlah"
            }
        }
        Feature::Lse => {
            // CAS family vs atomic-memory-op family.
            if w & 0x3F207C00 == 0x08207C00 {
                // Bit[23] discriminates: CASP has [23]=0, CAS has [23]=1.
                if w & 0x00800000 == 0 {
                    "casp"
                } else {
                    "cas"
                }
            } else {
                // Atomic memory ops: o3[15] + opc[14:12] picks the operation.
                match (w >> 12) & 0xF {
                    0x0 => "ldadd",
                    0x1 => "ldclr",
                    0x2 => "ldeor",
                    0x3 => "ldset",
                    0x4 => "ldsmax",
                    0x5 => "ldsmin",
                    0x6 => "ldumax",
                    0x7 => "ldumin",
                    0x8 => "swp",
                    _ => "<lse-atomic>",
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Encodings lifted from the assembled fixture (see aarch64-fixture.s).
    // Any change to the masks above must keep all of these green.

    #[test]
    fn flags_lse_cas() {
        assert_eq!(classify(0xc8a07c41), Some(Feature::Lse)); // cas x
        assert_eq!(classify(0x88e0fc41), Some(Feature::Lse)); // casal w
        assert_eq!(classify(0x08a07c41), Some(Feature::Lse)); // casb
        assert_eq!(classify(0x48207c82), Some(Feature::Lse)); // casp
        assert_eq!(classify(0xc8e0fc41), Some(Feature::Lse)); // casal x
    }

    #[test]
    fn flags_lse_atomic_ops() {
        assert_eq!(classify(0xf8208041), Some(Feature::Lse)); // swp
        assert_eq!(classify(0xf8200041), Some(Feature::Lse)); // ldadd
        assert_eq!(classify(0xf8201041), Some(Feature::Lse)); // ldclr
        assert_eq!(classify(0xf8202041), Some(Feature::Lse)); // ldeor
        assert_eq!(classify(0xf8203041), Some(Feature::Lse)); // ldset
        assert_eq!(classify(0xf8204041), Some(Feature::Lse)); // ldsmax
        assert_eq!(classify(0xf8207041), Some(Feature::Lse)); // ldumin
        assert_eq!(classify(0xf820003f), Some(Feature::Lse)); // stadd
    }

    #[test]
    fn flags_sve() {
        assert_eq!(classify(0x2518e3e0), Some(Feature::Sve)); // ptrue
        assert_eq!(classify(0xa400a000), Some(Feature::Sve)); // ld1b
        assert_eq!(classify(0x04210000), Some(Feature::Sve)); // add z
    }

    #[test]
    fn flags_rcpc() {
        assert_eq!(classify(0xf8bfc020), Some(Feature::Rcpc)); // ldapr x
        assert_eq!(classify(0x38bfc020), Some(Feature::Rcpc)); // ldaprb
    }

    #[test]
    fn flags_dotprod() {
        assert_eq!(classify(0x4e829420), Some(Feature::DotProd)); // sdot
        assert_eq!(classify(0x6e829420), Some(Feature::DotProd)); // udot
    }

    #[test]
    fn flags_jscvt() {
        assert_eq!(classify(0x1e7e0020), Some(Feature::Jscvt)); // fjcvtzs
    }

    #[test]
    fn flags_rdm() {
        assert_eq!(classify(0x6e828420), Some(Feature::Rdm)); // sqrdmlah
        assert_eq!(classify(0x6e828c20), Some(Feature::Rdm)); // sqrdmlsh
    }

    #[test]
    fn flags_pac_nonhint() {
        assert_eq!(classify(0xf8200420), Some(Feature::PacNonHint)); // ldraa
        assert_eq!(classify(0xf8a00c20), Some(Feature::PacNonHint)); // ldrab
    }

    #[test]
    fn ignores_pac_hints() {
        // These are HINT-space; NOP on pre-PAC CPUs by architectural guarantee.
        assert_eq!(classify(0xd503233f), None); // paciasp
        assert_eq!(classify(0xd50323bf), None); // autiasp
        assert_eq!(classify(0xd503245f), None); // bti c
    }

    #[test]
    fn ignores_v8_0_baseline() {
        assert_eq!(classify(0xc85f7c20), None); // ldxr (v8.0 exclusive)
        assert_eq!(classify(0xc8027c20), None); // stxr
        assert_eq!(classify(0x9ac14c00), None); // crc32x (our +crc has this)
        assert_eq!(classify(0x1f420c20), None); // fmadd
        assert_eq!(classify(0x4eb1b820), None); // addv (NEON)
        assert_eq!(classify(0xc8dffc20), None); // ldar (v8.0 acquire)
        assert_eq!(classify(0xc89ffc20), None); // stlr (v8.0 release)
        assert_eq!(classify(0xd65f03c0), None); // ret
                                                // Regression: stxp with Rt2=xzr collided with CAS ([14:10]=11111).
                                                // Found in libpas (pas_segregated_page_construct).
        assert_eq!(classify(0xc8297d1f), None); // stxp w9, xzr, xzr, [x8]
        assert_eq!(classify(0xc87f251f), None); // ldxp xzr, x9, [x8]
    }

    #[test]
    fn mnemonics_are_sane() {
        assert_eq!(rough_mnemonic(0xf8208041, Feature::Lse), "swp");
        assert_eq!(rough_mnemonic(0xf8200041, Feature::Lse), "ldadd");
        assert_eq!(rough_mnemonic(0xc8a07c41, Feature::Lse), "cas");
        assert_eq!(rough_mnemonic(0x48207c82, Feature::Lse), "casp");
        assert_eq!(rough_mnemonic(0xf8bfc020, Feature::Rcpc), "ldapr");
        assert_eq!(rough_mnemonic(0x4e829420, Feature::DotProd), "sdot");
        assert_eq!(rough_mnemonic(0x6e829420, Feature::DotProd), "udot");
        assert_eq!(rough_mnemonic(0x6e828420, Feature::Rdm), "sqrdmlah");
        assert_eq!(rough_mnemonic(0x6e828c20, Feature::Rdm), "sqrdmlsh");
        assert_eq!(rough_mnemonic(0xf8200420, Feature::PacNonHint), "ldraa");
        assert_eq!(rough_mnemonic(0xf8a00c20, Feature::PacNonHint), "ldrab");
    }
}
