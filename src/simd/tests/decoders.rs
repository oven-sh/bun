//! src/simd/detect.rs and src/simd/tuning.rs as they are on each architecture and system, with made-up answers, against tables that are written
//! from `cpuid.h` of GCC, the headers of Linux and Windows, and the detection of `std`. What asks the system is in system.rs.
#![allow(dead_code, unreachable_pub)]
#![cfg(all(target_arch = "x86_64", not(miri)))]
#![allow(dead_code, unused_imports, unused_macros, unexpected_cfgs, clippy::duplicate_mod)]
#[macro_use(rules)]
extern crate bun_simd_macros;
use bun_simd_macros::join as __join;
use std::cell::Cell;

thread_local! {
    /// What the CPU or the system reports.
    static BITS: Cell<[u64; 4]> = const { Cell::new([0; 4]) };
    /// Anything else, by architecture.
    static MORE: Cell<[u64; 8]> = const { Cell::new([0; 8]) };
    static MODEL: Cell<Option<CpuModel>> = const { Cell::new(None) };
}
fn bit(n: usize) -> bool {
    BITS.get()[n / 64] >> (n % 64) & 1 != 0
}
use x86::detect::{CpuModel, CpuVendor};
fn cpu_model() -> CpuModel {
    MODEL.get().expect("the model is not needed")
}
const X86: bool = true;
mod gate {
    pub fn is_tuned<const BIT: u32>() -> bool {
        crate::bit(BIT as usize)
    }
}
mod detect {
    pub(crate) use crate::cpu_model as first_model;
    pub fn fp512() -> bool {
        crate::MODEL.get().unwrap().model == 512
    }
    pub mod os {
        pub fn auxv(keys: [u64; 1]) -> [u64; 1] {
            assert_eq!(keys, [27]);
            [crate::MORE.get()[0]]
        }
    }
}

macro_rules! os { ($word:ident $($more:item)*) => {
    mod os {
        use crate::*;
        pub fn hwcap() -> [$word; 2] { [BITS.get()[0] as $word, BITS.get()[1] as $word] }
        pub fn midr() -> u64 { MORE.get()[0] }
        $($more)*
    }
    pub fn read_again() -> u64 { read() }
}; }
macro_rules! arch {
    (x86 { $($it:tt)* } $($others:tt)*) => {
        $($it)* os!(u64);
        fn __cpuid_count(leaf: u32, sub: u32) -> CpuidResult { let [eax, ebx, ecx, edx] = crate::cpuid(leaf, sub); CpuidResult { eax, ebx, ecx, edx } }
        unsafe fn _xgetbv(which: u32) -> u64 { assert!(which == 0 && crate::bit(26) && crate::bit(27), "XGETBV faults"); crate::BITS.get()[3] >> 32 | crate::MORE.get()[5] << 32 }
    };
    (darwin $a:tt { $($it:tt)* } $($others:tt)*) => { $($it)* os!(u64 pub fn has(key: &core::ffi::CStr) -> bool {
        bit(at(DARWIN, key.to_str().unwrap().strip_prefix("hw.optional.").unwrap()))
    }); };
    (windows $a:tt { $($it:tt)* } $($others:tt)*) => { $($it)* os!(u64 pub fn has(number: u32) -> bool { bit(number as usize) }); };
    (other $a:tt $b:tt { $($it:tt)* }) => { $($it)* os!(u64); };
    ($linux_or_bare:ident $a:tt { $($it:tt)* } $($others:tt)*) => { $($it)* os!(u64); };
}
/// Each `cfg_select!` of the two files, by its shape.
macro_rules! select {
    ($on:ident all $p:tt => $a:tt target_arch = "aarch64" => $b:tt _ => $c:tt) => { arch! { $on $a $b $c } };
    (darwin all $p:tt => { $($it:tt)* } all $q:tt => $b:tt _ => $c:tt) => { $($it)* };
    (windows all $p:tt => $a:tt all $q:tt => { $($it:tt)* } _ => $c:tt) => { $($it)* };
    ($on:ident all $p:tt => $a:tt all $q:tt => $b:tt _ => { $($it:tt)* }) => { $($it)* };
    (linux miri => $a:expr, any $p:tt => $b:expr, any $q:tt => $c:tt _ => $d:expr,) => { $c };
    (bare miri => $a:expr, any $p:tt => $b:expr, any $q:tt => $c:tt _ => $d:expr,) => {{ assert_eq!($a, $d); $d }};
    ($on:ident miri => $a:expr, any $p:tt => $b:expr, any $q:tt => $c:tt _ => $d:expr,) => { $b };
    (windows target_has_atomic = "64" => $a:tt _ => $b:expr,) => { $b };
    ($on:ident target_has_atomic = "64" => $a:tt _ => $b:expr,) => { $a };
    (x86 any $p:tt => { $($it:tt)* } target_arch = "aarch64" => $b:tt _ => $c:tt) => { $($it)* };
    (linux any $p:tt => $a:tt target_arch = "aarch64" => { $($it:tt)* } _ => $c:tt) => { $($it)* };
    ($on:ident any $p:tt => $a:tt target_arch = "aarch64" => $b:tt _ => { $($it:tt)* }) => { $($it)* };
    ($on:ident all $p:tt => { $a:expr } _ => $b:expr,) => { select! { $on all $p => $a, _ => $b, } };
    (linux all $p:tt => $a:expr, _ => $b:expr,) => { $a };
    ($on:ident all $p:tt => $a:expr, _ => $b:expr,) => { $b };
}
#[bun_simd_macros::rules]
macro_rules! systems { ($($name:ident $on:ident [$($true:tt)*];)*) => { $(#[path = ".."] mod $name {
    macro_rules! cfg { $($true => { true };)* ($$($$other:tt)*) => { false }; }
    macro_rules! cfg_select { ($$($$arms:tt)*) => { select! { $on $$($$arms)* } }; }
    pub mod detect;
    pub mod tuning;
})* }; }
systems! {
    x86 x86 []; netbsd x86 [(target_os = "netbsd")]; mac x86 [(target_vendor = "apple")]; win x86 [(target_os = "windows")];
    enclave x86 [(any(miri, target_env = "sgx"))]; once x86 []; unread x86 []; compiled x86 [(all(target_feature = "avx512vp2intersect", target_feature = "avx512bf16")) (target_feature = "avx2") (target_feature = "avx512fp16")];
    linux linux [(panic = "unwind")]; android linux [(target_os = "android")];
    freebsd linux [(target_os = "freebsd")];
    darwin darwin [(target_vendor = "apple")]; windows windows [(panic = "unwind")]; windows_abort windows []; bare bare [];
    cached linux []; empty linux []; other other [];
}

/// The number of a name in `NAME:number ..`.
fn at(bits: &str, name: &str) -> usize {
    bits.split_whitespace()
        .find_map(|it| it.strip_prefix(name)?.strip_prefix(':'))
        .unwrap_or_else(|| panic!("{name}"))
        .parse()
        .unwrap()
}

/// A row of `table` is `feature = A B C|D`, which wants all of A, B and one of C and D. A name can be a row above, and `-` is never there.
/// `seen` is what the decoder should believe of what is reported.
fn check(names: &[&str], read: fn() -> u64, bits: &str, table: &str, seen: impl Fn([u64; 4]) -> [u64; 4]) {
    let mut rows: Vec<(&str, Vec<Vec<usize>>)> = vec![];
    for row in table.split(',').map(str::trim).filter(|it| !it.is_empty()) {
        let (name, needs) = row.split_once('=').unwrap();
        let needs = needs
            .split_whitespace()
            .flat_map(|it| match rows.iter().rfind(|row| row.0 == it) {
                Some(row) => row.1.clone(),
                None if it == "-" => vec![vec![]],
                None => vec![it.split('|').map(|it| at(bits, it)).collect()],
            })
            .collect();
        rows.push((name.trim(), needs));
    }
    let rows: Vec<_> = names
        .iter()
        .map(|name| &rows.iter().rfind(|row| row.0 == *name).unwrap_or_else(|| panic!("{name}")).1)
        .collect();
    let one = |words: [u64; 4]| {
        let seen = seen(words);
        let want = rows.iter().rfold(0, |all, row| {
            all << 1 | row.iter().all(|any| any.iter().any(|n| seen[n / 64] >> (n % 64) & 1 != 0)) as u64
        });
        BITS.set(words);
        let wrong = read() ^ want;
        assert!(
            wrong == 0,
            "{:?} for {words:x?} {:x?}",
            names.iter().enumerate().filter(|it| wrong >> it.0 & 1 != 0).collect::<Vec<_>>(),
            MORE.get()
        );
    };
    let flip = |mut words: [u64; 4], n: usize| {
        words[n / 64] ^= 1 << (n % 64);
        words
    };
    let used: Vec<usize> = bits.split_whitespace().map(|it| it.rsplit(':').next().unwrap().parse().unwrap()).collect();
    let least = rows.iter().map(|row| {
        row.iter().filter_map(|any| any.first()).fold([0; 4], |mut words, n| {
            words[n / 64] |= 1u64 << (n % 64);
            words
        })
    });
    for words in least.chain([[0; 4], [!0; 4]]) {
        one(words);
        for n in 0..256 {
            one(flip(words, n))
        }
    }
    for &a in &used {
        for &b in used.iter().filter(|&&b| b > a) {
            one(flip(flip([!0; 4], a), b));
            one(flip(flip([0; 4], a), b))
        }
    }
    let mut state = 1u64;
    let mut next = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state ^ state >> 29
    };
    for round in 0..300 {
        one([0; 4].map(|_| (0..=round % 4).fold(0, |word, _| word | next())))
    }
}
macro_rules! check { ($on:ident, $bits:expr, $table:expr $(, $seen:expr)?) => {
    check($on::detect::NAMES, $on::detect::read_again, $bits, &$table, check!(@ $($seen)?))
}; (@) => { |it| it }; (@ $seen:expr) => { $seen }; }

/// 32 bits each: ECX of leaf 1, EBX, ECX and EDX of 7, EAX and EDX of 7.1, ECX of 0x80000001, and XCR0.
const CPUID: &str = "SSE3:0 PCLMUL:1 SSSE3:9 FMA:12 CX16:13 SSE41:19 SSE42:20 MOVBE:22 POPCNT:23 AES:25 XSAVE:26 OSXSAVE:27 AVX:28 F16C:29
    BMI:35 AVX2:37 BMI2:40 ERMS:41 F:48 DQ:49 ADX:51 IFMA:53 CD:60 SHA:61 BW:62 VL:63
    VBMI:65 VBMI2:70 GFNI:72 VAES:73 VPCLMUL:74 VNNI:75 BITALG:76 VPOPCNT:78 VP2:104 FP16:119
    SHA512:128 SM3:129 SM4:130 AVXVNNI:132 BF16:133 AVXIFMA:151 INT8:164 NECONVERT:165 INT16:170
    ABM:197 XMM:225 YMM:226 K:229 ZMM:230 HI16:231";
const ON_X86: &str = "sse2 =, sse3 = SSE3, pclmulqdq = PCLMUL, ssse3 = SSSE3, cmpxchg16b = CX16, sse4.1 = SSE41, sse4.2 = SSE42, movbe = MOVBE, popcnt = POPCNT,
    aes = AES, ermsb = ERMS, adx = ADX, sha = SHA, gfni = GFNI, bmi1 = bmi BMI, bmi2 = bmi BMI2, lzcnt = ABM,
    fma = avx FMA, f16c = avx F16C, avx2 = avx AVX2, vaes = avx VAES, vpclmulqdq = avx VPCLMUL, sha512 = avx SHA512, sm3 = avx SM3, sm4 = avx SM4,
    avxvnni = avx AVXVNNI, avxifma = avx AVXIFMA, avxvnniint8 = avx INT8, avxneconvert = avx NECONVERT, avxvnniint16 = avx INT16,
    avx512dq = avx512f DQ, avx512ifma = avx512f IFMA, avx512cd = avx512f CD, avx512bw = avx512f BW, avx512vl = avx512f VL, avx512vbmi = avx512f VBMI,
    avx512vbmi2 = avx512f VBMI2, avx512vnni = avx512f VNNI, avx512bitalg = avx512f BITALG, avx512vpopcntdq = avx512f VPOPCNT,
    avx512vp2intersect = avx512f VP2, avx512fp16 = avx512f FP16, avx512bf16 = avx512f BF16";
const AVX: &str = "avx = XSAVE OSXSAVE XMM YMM AVX, avx512f = avx K ZMM HI16 F FMA F16C,";
const VENDORS: [(&[u8; 12], &str); 7] = [
    (b"GenuineIntel", "Intel"),
    (b"AuthenticAMD", "Amd"),
    (b"HygonGenuine", "Hygon"),
    (b"CentaurHauls", "Zhaoxin"),
    (b"  Shanghai  ", "Zhaoxin"),
    (b"GenuineIotel", "Other"),
    (b"GenuntelineI", "Other"),
];

/// `MORE` has the highest leaves (basic, of 7, extended), the vendor, EAX of leaf 0x8000001a, all other registers, and EAX of leaf 1.
fn cpuid(leaf: u32, sub: u32) -> [u32; 4] {
    let [basic, of_7, extended, vendor, units, x, signature, _] = MORE.get().map(|it| it as u32);
    let (word, name) = (
        |n: usize| (BITS.get()[n / 2] >> (n % 2 * 32)) as u32,
        |n: usize| u32::from_le_bytes(VENDORS[vendor as usize].0.as_chunks().0[n]),
    );
    assert!(
        leaf <= basic || leaf == 1 << 31 || leaf > 1 << 31 && leaf <= extended && extended < 0x8001_0000,
        "there is no leaf {leaf:x}"
    );
    match (leaf, sub) {
        (0, 0) => [basic, name(0), name(2), name(1)],
        (1, 0) => [signature, x, word(0), x],
        (7, 0) => [of_7, word(1), word(2), word(3)],
        (7, 1) if of_7 >= 1 => [word(4), !word(1), x, word(5)],
        (0x8000_0000, 0) => [extended, x, x, x],
        (0x8000_0001, 0) => [x, x, word(6), x],
        (0x8000_001a, 0) => [units, x, x, x],
        _ => panic!("there is no leaf {leaf:x}.{sub}"),
    }
}

#[test]
fn x86_vendors() {
    for (vendor, (_, name)) in VENDORS.iter().enumerate() {
        MORE.set([
            0x24 + vendor as u64 % 2,
            1 + vendor as u64 % 2,
            [0x8000_0001, 0x8000_ffff][vendor % 2],
            vendor as u64,
            0,
            !0 * (vendor as u64 % 2),
            0,
            0,
        ]);
        let bmi = if *name == "Intel" { "avx" } else { "" };
        check!(x86, CPUID, format!("{AVX} bmi = {bmi}, {ON_X86}"));
    }
}

#[test]
fn x86_leaves_that_are_missing() {
    for (basic, of_7, extended, keep) in [
        (0, 1, 0x8000_0001, [0, 0, 0, !0]),
        (1, 1, 0x8000_0001, [!0 >> 32, 0, 0, !0]),
        (6, 1, 0x8000_0001, [!0 >> 32, 0, 0, !0]),
        (7, 0, 0x8000_0001, [!0, !0, 0, !0]),
        (7, 1, 0x8000_0000, [!0, !0, !0, !0 << 32]),
        (0x23, 1, 0x8001_0000, [!0, !0, !0, !0 << 32]),
        (0x23, 1, 0x16, [!0, !0, !0, !0 << 32]),
    ] {
        MORE.set([basic, of_7, extended, 1, 2, !0, 0, 0]);
        check!(x86, CPUID, format!("{AVX} bmi =, {ON_X86}"), |words| core::array::from_fn(|i| words[i] & keep[i]));
    }
}

#[test]
fn x86_subleaf_that_is_ignored() {
    use x86::detect::*;
    let first = [1, 2, 4, 16];
    let found = |next| decode(|leaf, sub| if leaf == 7 { [first, next][sub as usize] } else { [!0; 4] }, || !0);
    assert_eq!(found(first), found([0; 4]));
    for i in 0..4 {
        let mut next = first;
        next[i] |= 1 << 31;
        assert_eq!(found(next), found(first) | mask(&["sha512", "avxvnniint8"]));
    }
}

#[test]
fn x86_systems() {
    MORE.set([0x24, 1, 0x8000_0008, 0, 2, 0, 0, 0]);
    let rest = format!("bmi = avx, {ON_X86}");
    check!(win, CPUID, format!("{AVX} {rest}"));
    check!(mac, CPUID, format!("{AVX} avx512f = -, {rest}"));
    check!(netbsd, CPUID, format!("avx = -, avx512f = -, {rest}"));
    check!(enclave, CPUID, format!("{AVX} {rest}"), |_| [0; 4]);
    check!(compiled, CPUID, format!("{AVX} {rest}, avx2 =, avx512fp16 ="));
    assert_eq!((compiled::detect::BASELINE, x86::detect::BASELINE), (x86::detect::mask(&["avx2", "avx512fp16"]), 0));
}

#[test]
fn x86_models() {
    // 486, Pentium with bits that don't count yet, Skylake-X, Alder Lake, Pentium 4, Zen 2, Zen 5, Dhyana, KX-6000, and all bits.
    for (signature, family, model, stepping) in [
        (0x0435, 4, 3, 5),
        (0xf_0543, 5, 4, 3),
        (0x5_0654, 6, 0x55, 4),
        (0xff9_0672, 6, 0x97, 2),
        (0x0f29, 15, 2, 9),
        (0x83_0f10, 0x17, 0x31, 0),
        (0xb1_0f10, 0x1a, 0x11, 0),
        (0x90_0f01, 0x18, 0, 1),
        (0x1_07b5, 7, 0x1b, 5),
        (0xffff_ffff, 15 + 255, 255, 15),
        (0xf000_f000, 0, 0, 0),
        (0xf600, 6, 0, 0),
    ] {
        for (vendor, (_, name)) in VENDORS.iter().enumerate() {
            MORE.set([1, 0, 0, vendor as u64, 0, !0, signature, 0]);
            let now = once::detect::cpu_model();
            assert!(signature != 0x0435 || vendor != 0 || once::detect::first_model() == now);
            once::detect::read_again();
            MORE.set([1, 0, 0, vendor as u64, 0, !0, 7, 0]);
            assert_eq!(once::detect::first_model(), now);
            MORE.set([1, 0, 0, vendor as u64, 0, !0, 0, 0]);
            once::detect::read_again();
            MORE.set([1, 0, 0, vendor as u64, 0, !0, signature, 0]);
            assert_eq!(once::detect::first_model(), now);
            assert_eq!(
                format!("{:?}", x86::detect::cpu_model()),
                format!("CpuModel {{ vendor: {name}, family: {family}, model: {model}, stepping: {stepping} }}")
            );
        }
    }
    assert_eq!(format!("{:?}", enclave::detect::cpu_model()), UNKNOWN);
    // As Zen 4 and Zen 5 answer.
    for (extended, units, want) in [
        (0x8000_0028, 6, false),
        (0x8000_0028, 10, true),
        (0x8000_001a, 8, true),
        (0x8000_0019, !0, false),
        (0x8000_ffff, 8, true),
        (0x8001_0000, !0, false),
        (7, !0, false),
        (0x8000_0028, !8, false),
    ] {
        MORE.set([1, 0, extended, 1, units, !0, 0, 0]);
        once::detect::read_again();
        assert_eq!([unread::detect::fp512(), once::detect::fp512(), enclave::detect::fp512()], [want, want, false]);
        MORE.set([1, 0, 0x8000_0028, 1, units, !0, 0, 0]);
        assert_eq!(once::detect::fp512(), want);
    }
}
const UNKNOWN: &str = "CpuModel { vendor: Other, family: 0, model: 0, stepping: 0 }";

const HWCAP: &str = "FP:0 ASIMD:1 AES:3 PMULL:4 SHA1:5 SHA2:6 CRC32:7 ATOMICS:8 FPHP:9 ASIMDHP:10 CPUID:11 ASIMDRDM:12 JSCVT:13 FCMA:14 LRCPC:15 SHA3:17 SM3:18 SM4:19
    ASIMDDP:20 SHA512:21 SVE:22 ASIMDFHM:23 SVE2:65 SVEAES:66 SVEPMULL:67 SVEBITPERM:68 SVESHA3:69 SVESM4:70 FRINT:72 SVEI8MM:73 SVEF32MM:74 SVEBF16:76 I8MM:77 BF16:78
    CSSC:98 SVE2P1:100 MOPS:107 LUT:113 FAMINMAX:114";
const AARCH64: &str = "neon = FP ASIMD, crc = CRC32, aes = ASIMD AES PMULL, sha2 = ASIMD SHA1 SHA2, sha3 = sha2 SHA3 SHA512, sm4 = ASIMD SM3 SM4, lse = ATOMICS,
    fp16 = FP ASIMD FPHP ASIMDHP, rdm = ASIMD ASIMDRDM, jsconv = FP JSCVT, fcma = ASIMD FCMA, rcpc = LRCPC, dotprod = ASIMD ASIMDDP,
    fhm = ASIMD FPHP ASIMDHP ASIMDFHM, frintts = FRINT, i8mm = ASIMD I8MM, bf16 = ASIMD BF16,
    sve = ASIMD SVE, sve2 = sve SVE2, sve2-aes = sve2 aes SVEAES SVEPMULL, sve2-bitperm = sve2 SVEBITPERM,
    sve2-sha3 = sve2 sha3 SVESHA3, sve2-sm4 = sve2 sm4 SVESM4,";
const NO_SVE: &str = "sve = -, sve2 = -, sve2-aes = -, sve2-bitperm = -, sve2-sha3 = -, sve2-sm4 = -,";

/// Without SVE, if it lacks what NEON has.
fn whole(bits: &str) -> impl Fn([u64; 4]) -> [u64; 4] {
    let [sve, names @ ..] = ["SVE", "I8MM", "SVEI8MM", "BF16", "SVEBF16"].map(|it| at(bits, it));
    move |mut words| {
        if let [true, false, ..] | [.., true, false] = names.map(|n| words[n / 64] >> (n % 64) & 1 != 0) {
            words[0] &= !(1 << sve);
        }
        words
    }
}

#[test]
fn aarch64_hwcap() {
    let (v8, whole) = (|words: [u64; 4]| [words[0] & 255, 0, 0, 0], whole(HWCAP));
    let by_age = |words: [u64; 4]| if words[0] < 2048 { v8(words) } else { whole(words) };
    check!(linux, HWCAP, AARCH64, by_age);
    check!(freebsd, HWCAP, format!("{AARCH64} {NO_SVE}"), by_age);
    check!(android, HWCAP, AARCH64, |words| if words[0] & 2048 == 0 { v8(words) } else { whole(words) });
    check!(bare, HWCAP, AARCH64, |_| [0; 4]);
}

/// Linux in a virtual machine on Apple M4: oven-sh/bun#45099.
#[test]
fn aarch64_sve2_without_sve() {
    use linux::detect::*;
    BITS.set([!(1 << 22), !0, 0, 0]);
    assert_eq!(read_again() & mask(&["sve", "sve2", "sve2-aes", "i8mm"]), mask(&["i8mm"]));
}

const DARWIN: &str = "armv8_crc32:0 arm.FEAT_CRC32:1 arm.FEAT_AES:2 arm.FEAT_PMULL:3 arm.FEAT_SHA1:4 arm.FEAT_SHA256:5 arm.FEAT_SHA3:6 arm.FEAT_SHA512:7 arm.FEAT_LSE:8
    arm.FEAT_FP16:9 arm.FEAT_RDM:10 arm.FEAT_JSCVT:11 arm.FEAT_FCMA:12 arm.FEAT_LRCPC:13 arm.FEAT_DotProd:14 arm.FEAT_FHM:15 arm.FEAT_FRINTTS:16
    arm.FEAT_I8MM:17 arm.FEAT_BF16:18 arm.FEAT_CSSC:19";

#[test]
fn aarch64_darwin_and_windows() {
    // All targets for Darwin are compiled for NEON.
    check!(darwin, DARWIN, format!("{NO_SVE} neon = -, sm4 = -, crc = armv8_crc32|arm.FEAT_CRC32,
        aes = arm.FEAT_AES arm.FEAT_PMULL, sha2 = arm.FEAT_SHA1 arm.FEAT_SHA256, sha3 = arm.FEAT_SHA3 arm.FEAT_SHA512, lse = arm.FEAT_LSE, fp16 = arm.FEAT_FP16,
        rdm = arm.FEAT_RDM, jsconv = arm.FEAT_JSCVT, fcma = arm.FEAT_FCMA, rcpc = arm.FEAT_LRCPC, dotprod = arm.FEAT_DotProd, fhm = fp16 arm.FEAT_FHM,
        frintts = arm.FEAT_FRINTTS, i8mm = arm.FEAT_I8MM, bf16 = arm.FEAT_BF16"));
    let bits = "NEON:19 CRYPTO:30 CRC32:31 ATOMIC:34 DP:43 JSCVT:44 LRCPC:45 SVE:46 SVE2:47 SVE2_1:48 SVE_AES:49 SVE_PMULL128:50 SVE_BITPERM:51 SVEBF16:52 SVE_SHA3:55
        SVEI8MM:57 SVE_F32MM:58 SHA3:64 SHA512:65 I8MM:66 FP16:67 BF16:68";
    let table = "neon = NEON, crc = CRC32, aes = CRYPTO, sha2 = CRYPTO, sha3 = CRYPTO SHA3 SHA512, sm4 = -, lse = ATOMIC, fp16 = FP16, rdm = DP, jsconv = JSCVT,
        fcma = SVE SVE2, rcpc = LRCPC, dotprod = DP, fhm = SVE SVE2 FP16, frintts = -, i8mm = I8MM, bf16 = BF16, sve = SVE,
        sve2 = sve SVE2, sve2-aes = sve2 aes SVE_AES SVE_PMULL128, sve2-bitperm = sve2 SVE_BITPERM,
        sve2-sha3 = sve2 sha3 SVE_SHA3, sve2-sm4 = -,";
    check!(windows_abort, bits, table, whole(bits));
    check!(windows, bits, format!("{table} {NO_SVE}"), whole(bits));
}

#[test]
fn aarch64_models() {
    // Neoverse V1 r1p1, Falkor, M1, A64FX, nothing, and all bits.
    for (midr, vendor, on_darwin, family, model, stepping) in [
        (0x411f_d401, "Arm", "Arm", 0x41, 0xd40, 0x11),
        (0x510f_c000, "Qualcomm", "Qualcomm", 0x51, 0xc00, 0),
        (0x611f_0221, "Apple", "Apple", 0x61, 0x22, 0x11),
        (0x461f_0010, "Other", "Apple", 0x46, 1, 0x10),
        (0, "Other", "Apple", 0, 0, 0),
        (!0, "Other", "Apple", 255, 0xfff, 255),
        (0xff_c10f_0000, "Other", "Apple", 0xc1, 0, 0),
        (0xff_4100_0000, "Arm", "Arm", 0x41, 0, 0),
    ] {
        MORE.set([midr; 8]);
        let want =
            |vendor| format!("CpuModel {{ vendor: {vendor}, family: {family}, model: {model}, stepping: {stepping} }}");
        assert_eq!(
            [format!("{:?}", linux::detect::cpu_model()), format!("{:?}", darwin::detect::cpu_model())],
            [want(vendor), want(on_darwin)]
        );
    }
}

#[test]
fn other_architectures() {
    check!(other, "", "simd128 = -, relaxed-simd = -");
    assert_eq!(format!("{:?}", other::detect::cpu_model()), UNKNOWN);
    assert!(!other::detect::fp512()); // as for x86 without SSE2
}

#[test]
fn names_and_cache() {
    use cached::detect::*;
    for (i, name) in NAMES.iter().enumerate() {
        assert_eq!((index(name), mask(&[name])), (Some(i as u32), 1 << i))
    }
    assert_eq!((index("crd"), index("cr"), index(""), mask(&["crc", "neon", "crc"])), (None, None, None, 3));
    BITS.set([3, 0, 0, 0]);
    assert_eq!(all(), 1);
    BITS.set([!0; 4]);
    assert_eq!((all(), has(0), has(1), has(2), has(3)), (1, true, true, false, false));
    assert_eq!(cpu_features().take(3).collect::<Vec<_>>(), [("neon", true), ("crc", false), ("aes", false)]);
    // Also nothing is kept.
    BITS.set([0; 4]);
    assert_eq!(empty::detect::all(), 0);
    BITS.set([!0; 4]);
    assert_eq!(empty::detect::all(), 0);
    // Without atomics of 64 bits it asks each time.
    assert_eq!(windows::detect::all() & 7, 7);
    BITS.set([0; 4]);
    assert_eq!(windows::detect::all(), 0);
    BITS.set([1 << 19 | 1 << 43, 0, 0, 0]);
    assert_eq!(
        windows::detect::cpu_features().filter(|it| it.1).map(|it| it.0).collect::<Vec<_>>(),
        ["neon", "rdm", "dotprod"]
    );
}

#[test]
fn same_text() {
    use other::detect::same_text;
    assert!(same_text("", "") && same_text("ab", "ab"));
    assert!(!same_text("ab", "bb") && !same_text("ab", "aa") && !same_text("ab", "a") && !same_text("a", "ab"));
}

#[test]
fn tuning() {
    assert_eq!(x86::tuning::masked_loads(), !0);
    use CpuVendor::*;
    let words = |names: &[&str], bits: u64| {
        names.iter().enumerate().filter(|it| bits >> it.0 & 1 != 0).map(|it| &it.1[5..]).collect::<Vec<_>>().join(" ")
    };
    for (vendor, family, has, want) in [
        (Intel, 6, "", "pdep compress_store"),
        (Intel, 6, "avx512f", "pdep compress_store"),
        (Intel, 6, "avxvnni", "pdep gather compress_store"),
        (Intel, 6, "avx512fp16", "pdep gather compress_store"),
        (Intel, 6, "avx512f avx512fp16", "pdep gather zmm compress_store"),
        (Amd, 0x18, "avx512f avxvnni avx512fp16", ""),
        (Amd, 0x19, "", "pdep"),
        (Amd, 0x19, "avx512f", "pdep zmm"),
        (Amd, 0x1a, "avxvnni", "pdep compress_store"),
        (Amd, 0x1a, "avx512f avxvnni", "pdep zmm compress_store"),
        (Amd, 0x1b, "avx512f", "pdep zmm compress_store"),
        (Hygon, 0x1a, "avx512f avxvnni", ""),
        (Zhaoxin, 7, "avx512f avxvnni", ""),
        (Other, 0x1a, "avx512f", ""),
    ] {
        MODEL.set(Some(CpuModel { vendor, family, model: 0, stepping: 0 }));
        assert_eq!(
            words(&x86::tuning::NAMES[..4], x86::tuning::detect(|name| has.split(' ').any(|it| it == name))),
            want,
            "{vendor:?} {family} {has}"
        );
    }
    for (vendor, family, model, fast) in [
        (Amd, 0x15, 0x60, false),
        (Amd, 0x17, 0x2f, false),
        (Amd, 0x17, 0x30, true),
        (Amd, 0x19, 0, true),
        (Hygon, 0x18, 0x30, false),
        (Intel, 6, 0, true),
        (Other, 0, 0, true),
    ] {
        MODEL.set(Some(CpuModel { vendor, family, model, stepping: 0 }));
        x86::tuning::detect(|_| true);
        assert_eq!(x86::tuning::masked_loads(), if fast { !0 } else { 0 }, "{vendor:?} {family} {model}");
    }
    assert_eq!([&x86::tuning::NAMES[4..], &linux::tuning::NAMES[2..]], [["full_zmm"], ["fast_pdep"]]);
    MODEL.set(Some(CpuModel { vendor: Amd, family: 0x19, model: 512, stepping: 0 }));
    assert_eq!(x86::tuning::detect(|name| name == "avx512f") >> 4, 0);
    for family in [0, 0x41, 0x4e, 0x61, 0x6d] {
        for model in 0xd00..0xe00 {
            MODEL.set(Some(CpuModel { vendor: if family == 0x41 { Arm } else { Other }, family, model, stepping: 0 }));
            let server = family == 0x41 && [0xd49, 0xd4f, 0xd83, 0xd84, 0xd8e].contains(&model)
                || (family, model) == (0x6d, 0xd49);
            for recent in [0, 28] {
                MORE.set([recent; 8]);
                assert_eq!(
                    linux::tuning::detect(|name| name == "sve2-bitperm" || name == "aes"),
                    (server && recent != 0) as u64 * 4
                );
                assert_eq!(
                    linux::tuning::detect(|name| name != "sve2-bitperm") >> 2 | android::tuning::detect(|_| true) >> 2,
                    0
                );
            }
        }
    }
    for (vendor, model, has, want) in [
        (Amd, 512, true, true),
        (Amd, 512, false, false),
        (Amd, 0, true, false),
        (Intel, 0, true, true),
        (Intel, 0, false, false),
        (Hygon, 512, true, false),
    ] {
        MODEL.set(Some(CpuModel { vendor, family: 0x1a, model, stepping: 0 }));
        assert_eq!(x86::tuning::detect(|name| has && name == "avx512f") >> 4 == 1, want, "{vendor:?} {model} {has}");
    }
    for (vendor, model, want) in [
        (Apple, 0, "sha3 clmul"),
        (Arm, 0xd8e, "sha3"),
        (Arm, 0xd40, "clmul"),
        (Arm, 0xd4f, "clmul"),
        (Arm, 0xd84, "clmul"),
        (Qualcomm, 1, "clmul"),
        (Qualcomm, 0xd8e, ""),
        (Other, 0xd49, ""),
        (Other, 0, ""),
    ]
    .into_iter()
    .chain([0xd46, 0xd47, 0xd49, 0xd4d, 0xd80, 0xd81, 0xd87].map(|model| (Arm, model, "")))
    {
        MODEL.set(Some(CpuModel { vendor, family: 0, model, stepping: 0 }));
        let without = |lacks| words(linux::tuning::NAMES, linux::tuning::detect(|name| name != lacks));
        let less = want.trim_end_matches("clmul").trim();
        assert_eq!(
            [without(""), without("aes"), without("bf16")],
            [want, less, if vendor == Apple { want } else { less }],
            "{vendor:?} {model:x}"
        );
    }
    for (i, name) in x86::tuning::NAMES.iter().enumerate() {
        BITS.set([1 << i; 4]);
        assert_eq!(
            [x86::tuning::fast_gather(), x86::tuning::fast_masked_store(), compiled::tuning::fast_gather()],
            [*name == "fast_gather", *name == "fast_compress_store", true]
        );
    }
    for words in 0..32 {
        BITS.set([words; 4]);
        assert_eq!([x86::tuning::fast_conflict(), compiled::tuning::fast_conflict()], [words & 6 == 4, true]);
        assert_eq!(x86::tuning::one_port(), words >= 16 && words & 6 != 4);
    }
    MODEL.set(None);
    assert_eq!(
        (
            linux::tuning::detect(|name| name != "sha3" && name != "sve2-bitperm"),
            other::tuning::detect(|_| true),
            other::tuning::NAMES.len()
        ),
        (0, 0, 0)
    );
    // A kernel that doesn't know AT_RSEQ_FEATURE_SIZE is older than 6.3.
    for (sve2, tells) in [(false, 0), (false, 28), (true, 0), (true, 28), (true, 1)] {
        MORE.set([tells; 8]);
        assert_eq!((linux::tuning::wide(sve2), x86::tuning::wide(sve2)), (!sve2 || tells != 0, true));
    }
}
