//! The instructions that operations on vectors come down to.

#![allow(clippy::disallowed_methods)]

#[path = "support/shuffles.rs"]
mod shuffles;
mod support;
#[path = "support/vectors.rs"]
mod vectors;

use bun_engine_asm::FloatWidth::{F32, F64};
use bun_engine_asm::Size::{S8, S16, S32, S64};
use bun_engine_asm::VectorBinary::*;
use bun_engine_asm::VectorReduce::*;
use bun_engine_asm::VectorShift::*;
use bun_engine_asm::VectorTernary::*;
use bun_engine_asm::VectorUnary::*;
use bun_engine_asm::lanes::{ZERO, splat};
use bun_engine_asm::{
    Address, Arm64Features, Fpr, Gpr, Options, Reuse, Scratch, Sign, VectorAssembly, X64Features,
    arm64, x64,
};

const INTEL: [&str; 2] = ["-triple=x86_64", "--output-asm-variant=1"];
const D: Fpr = Fpr::new(0);
const A: Fpr = Fpr::new(1);
const AFTER_A: Fpr = Fpr::new(2);
const B: Fpr = Fpr::new(3);
const C: Fpr = Fpr::new(5);
const X: Gpr = Gpr::new(0);

type Emit<M> = Box<dyn Fn(&mut M)>;

/// The lines for each. `None` without LLVM.
fn listings<M: VectorAssembly>(
    features: M::Features,
    arguments: &[&str],
    cases: &[Emit<M>],
) -> Option<Vec<Vec<String>>> {
    let mut bytes = Vec::new();
    for emit in cases {
        let mut masm = M::new(Options {
            features,
            shorten_jumps: false,
            seed: 0,
        });
        emit(&mut masm);
        masm.breakpoint();
        let code = masm.finish().unwrap();
        bytes.extend(&code.bytes()[..code.instructions_end() as usize]);
    }
    let lines = support::disassemble(arguments, &bytes)?;
    let listings = lines.split(|line| line == "int3" || line.starts_with("brk"));
    Some(listings.take(cases.len()).map(<[_]>::to_vec).collect())
}

fn check<M: VectorAssembly>(
    features: M::Features,
    arguments: &[&str],
    cases: Vec<(&str, Emit<M>, &str)>,
) {
    let (expected, cases): (Vec<_>, Vec<_>) = cases
        .into_iter()
        .map(|(name, emit, expected)| ((name, expected), emit))
        .unzip();
    let listings = listings(features, arguments, &cases).unwrap_or_default();
    for (listing, (name, expected)) in listings.iter().zip(expected) {
        let names: Vec<_> = listing
            .iter()
            .map(|line| line.split(' ').next().unwrap())
            .collect();
        assert_eq!(names.join(" "), expected, "{name}: {listing:#?}");
    }
}

/// With SSE, with all features of x86-64, and on AArch64.
macro_rules! sequences {
    ($($method:ident $arguments:tt => $sse:literal, $avx:literal, $neon:literal;)*) => {{
        fn cases<M: VectorAssembly>(column: usize) -> Vec<(&'static str, Emit<M>, &'static str)> {
            vec![$((
                stringify!($method $arguments),
                Box::new(|masm: &mut M| masm.$method $arguments),
                [$sse, $avx, $neon][column],
            )),*]
        }
        check::<x64::MacroAssembler>(X64Features::empty(), &INTEL, cases(0));
        check::<x64::MacroAssembler>(X64Features::all(), &INTEL, cases(1));
        check::<arm64::MacroAssembler>(Arm64Features::all(), &support::ARM64, cases(2));
    }};
}

#[test]
fn constants_and_lanes() {
    const AT: Address = Address::new(X, 0);
    sequences! {
        move_vector_constant(D, 0) => "xorps", "vxorps", "movi";
        move_vector_constant(D, u128::MAX) => "pcmpeqd", "vpcmpeqd", "movi";
        move_vector_constant(D, 0x1234_5678) => "movss", "vmovss", "ldr";
        move_vector_constant(D, 1f64.to_bits().into()) => "movsd", "vmovsd", "fmov";
        move_vector_constant(D, splat(S32, 0x1200)) => "movddup", "vbroadcastss", "movi";
        move_vector_constant(D, splat(S32, !0x1200)) => "movddup", "vbroadcastss", "mvni";
        move_vector_constant(D, splat(S64, 2f64.to_bits())) => "movddup", "vmovddup", "fmov";
        move_vector_constant(D, 1 << 64) => "movaps", "vmovaps", "ldr";
        load_vector_splat(S8, D, AT) => "xorps pinsrb pshufb", "vpbroadcastb", "ld1r";
        load_vector_splat(S16, D, AT.plus(2)) => "xorps pinsrw pshufb", "vpbroadcastw", "ldr dup";
        load_vector_splat(S32, D, AT) => "movss shufps", "vbroadcastss", "ld1r";
        load_vector_lane(S64, A, A, 0, AT) => "movlps", "vmovlps", "ld1";
        load_vector_lane(S64, A, A, 1, AT.plus(8)) => "movhps", "vmovhps", "add ld1";
        store_vector_lane(S32, AT.plus(8), A, 0) => "movss", "vmovss", "str";
        store_vector_lane(S64, AT.plus(8), A, 0) => "movsd", "vmovsd", "str";
        store_vector_lane(S64, AT, A, 1) => "movhps", "vmovhps", "st1";
        splat_int(S8, D, X) => "movd pshufb", "vmovd vpbroadcastb", "dup";
        splat_int(S16, D, X) => "movd pshufb", "vmovd vpbroadcastw", "dup";
        splat_float(F32, D, A) => "pshufd", "vshufps", "dup";
        splat_float(F32, A, A) => "shufps", "vshufps", "dup";
        extract_int_lane(S8, Sign::Signed, X, A, 0) => "movd movsx", "vmovd movsx", "smov";
        extract_int_lane(S8, Sign::Unsigned, X, A, 0) => "pextrb", "vpextrb", "umov";
        extract_int_lane(S32, Sign::Signed, X, A, 0) => "movd", "vmovd", "mov";
        extract_float_lane(F32, A, A, 0) => "", "", "";
        extract_float_lane(F32, D, A, 1) => "movshdup", "vmovshdup", "mov";
        replace_float_lane(F32, A, A, 0, B) => "movss", "vblendps", "mov";
        replace_float_lane(F32, B, A, 0, B) => "blendps", "vblendps", "mov mov";
        replace_float_lane(F32, B, A, 2, B) => "shufps blendps", "vinsertps", "mov mov mov";
        replace_float_lane(F64, A, A, 0, B) => "movsd", "vblendps", "mov";
        replace_float_lane(F64, B, A, 1, B) => "movddup movsd", "vmovlhps", "zip1";
        first_in_byte_mask(X, X) => "bsf", "tzcnt", "rbit clz lsr";
        move_byte_mask(X, A) => "pmovmskb", "vpmovmskb", "shrn fmov";
    }
}

#[test]
fn arithmetic() {
    sequences! {
        vector_unary(Not, A, A) => "pcmpeqd pxor", "vpcmpeqd vpxor", "mvn";
        vector_unary(I32x4Neg, A, A) => "xorps psubd movaps", "vxorps vpsubd", "neg";
        vector_unary(I8x16Popcnt, A, A)
            => "movaps psrlw pand pand movaps pshufb movaps pshufb paddb",
            "vpsrlw vpand vpand vmovaps vpshufb vpshufb vpaddb",
            "cnt";
        vector_unary(I64x2Abs, A, A) => "pshufd psrad pxor psubq", "vxorps vpsubq vblendvpd", "abs";
        vector_unary(I16x8ExtendHighI8x16S, A, A) => "punpckhbw psraw", "vpunpckhbw vpsraw", "sshll2";
        vector_unary(I16x8ExtendHighI8x16S, D, A) => "pshufd pmovsxbw", "vpunpckhbw vpsraw", "sshll2";
        vector_binary(I64x2LeS, B, A, B) => "movaps pcmpgtq pcmpeqd pxor", "vpcmpgtq vpcmpeqd vpxor", "cmge";
        vector_binary(F32x4Ne, B, A, B) => "cmpneqps", "vcmpneqps", "fcmeq mvn";
        vector_binary(F32x4Lt, B, A, B) => "movaps cmpltps movaps", "vcmpltps", "fcmgt";
        vector_binary(I8x16NarrowI16x8S, A, A, A) => "packsswb", "vpacksswb", "sqxtn mov";
        vector_binary(I8x16NarrowI16x8S, B, A, B) => "movaps movaps packsswb", "vpacksswb", "sqxtn sqxtn mov";
        vector_binary(I16x8ExtMulLowI8x16S, D, A, A) => "pmovsxbw pmullw", "vpmovsxbw vpmullw", "smull";
        vector_binary(I16x8ExtMulHighI8x16U, B, A, B)
            => "xorps punpckhbw xorps punpckhbw pmulhuw", "vxorps vpunpckhbw vpunpckhbw vpmulhuw", "umull2";
        vector_binary(F64x2Min, B, A, B)
            => "movaps minpd minpd orps cmpunordpd orps psrlq xorps",
            "vminpd vminpd vorps vcmpunordpd vblendvpd",
            "fmin";
        vector_binary(F32x4Pmin, A, A, B) => "movaps movaps minps", "vminps", "fcmgt bit";
        vector_binary(F32x4Pmin, B, A, B) => "minps", "vminps", "fcmgt bif";
        vector_ternary(Bitselect, A, A, B, C) => "pxor pand pxor", "vpandn vpand vpor", "bif";
        vector_ternary(Bitselect, B, A, B, C) => "movaps pxor pand pxor", "vpandn vpand vpor", "bit";
        vector_ternary(Bitselect, C, A, B, C) => "movaps pandn pand por", "vpandn vpand vpor", "bsl";
        vector_ternary(F32x4RelaxedMadd, B, A, B, C) => "mulps addps", "vfmadd213ps", "mov fmla mov";
        vector_ternary(F32x4RelaxedMadd, C, A, B, C) => "movaps mulps addps", "vfmadd231ps", "fmla";
        vector_ternary(F32x4RelaxedMadd, A, A, B, A) => "movaps mulps addps", "vfmadd213ps", "fmla";
        vector_ternary(I32x4RelaxedDotI8x16I7x16AddS, C, A, B, C)
            => "movaps pmaddubsw pmaddwd paddd", "vpmaddubsw vpmaddwd vpaddd", "sdot";
        vector_reduce(AnyTrue, X, A) => "xor ptest setne", "xor vptest setne", "umaxp fmov cmp cset";
        vector_reduce(I8x16AllTrue, X, A)
            => "xorps pcmpeqb xor ptest sete", "vxorps vpcmpeqb xor vptest sete", "uminv fmov cmp cset";
        vector_reduce(I16x8Bitmask, X, A)
            => "xorps packsswb pmovmskb shr", "vxorps vpacksswb vpmovmskb", "ldr cmlt and addv fmov";
        vector_shift(I32x4Shl, A, A, 32) => "", "", "";
        vector_shift(I32x4Shl, A, A, 1) => "paddd", "vpaddd", "add";
        vector_shift(I8x16Shl, A, A, 2) => "paddb paddb", "vpaddb vpaddb", "shl";
        vector_shift(I8x16ShrS, D, A, 7) => "xorps pcmpgtb", "vxorps vpcmpgtb", "sshr";
        vector_shift(I64x2ShrS, D, A, 63) => "pshufd psrad", "vpshufd vpsrad", "sshr";
    }
}

/// From indices of lanes, of which there are `N` in a vector.
fn lanes<const N: usize>(lanes: [u8; N]) -> [u8; 16] {
    let bytes = 16 / N;
    std::array::from_fn(|byte| match lanes[byte / bytes] {
        ZERO => ZERO,
        lane => lane * bytes as u8 + (byte % bytes) as u8,
    })
}

fn bytes(source: impl Fn(u8) -> u8) -> [u8; 16] {
    std::array::from_fn(|byte| source(byte as u8))
}

#[test]
fn shuffles_of_one_vector() {
    const Z: u8 = ZERO;
    sequences! {
        vector_shuffle(D, A, B, [Z; 16]) => "xorps", "vxorps", "movi";
        vector_shuffle(B, A, B, lanes([2, 3])) => "", "", "";
        vector_shuffle(A, A, A, lanes([0, 3])) => "", "", "";
        vector_shuffle(D, A, B, lanes([1, 0])) => "pshufd", "vpshufd", "ext";
        vector_shuffle(D, A, B, lanes([1, 0, 3, 2])) => "pshufd", "vpshufd", "rev64";
        vector_shuffle(D, A, B, lanes([3, 2, 1, 0])) => "pshufd", "vpshufd", "ldr tbl";
        vector_shuffle(A, A, B, lanes([0, 1, 0, 3])) => "pshufd", "vpshufd", "mov";
        vector_shuffle(D, A, B, lanes([6; 4])) => "pshufd", "vpshufd", "dup";
        vector_shuffle(A, A, B, lanes([0; 8])) => "pshufb", "vpbroadcastw", "dup";
        vector_shuffle(A, A, B, [0; 16]) => "pshufb", "vpbroadcastb", "dup";
        vector_shuffle(A, A, B, [7; 16]) => "pshufb", "vpshufb", "dup";
        vector_shuffle(D, A, B, lanes([3, 2, 1, 0, 4, 5, 6, 7])) => "pshuflw", "vpshuflw", "ldr tbl";
        vector_shuffle(D, A, B, lanes([0, 1, 2, 3, 7, 6, 5, 4])) => "pshufhw", "vpshufhw", "ldr tbl";
        vector_shuffle(A, A, B, lanes([4, 4, 5, 5, 6, 6, 7, 7])) => "punpckhwd", "vpunpckhwd", "zip2";
        vector_shuffle(A, A, B, bytes(|i| (i + 5) % 16)) => "palignr", "vpalignr", "ext";
        vector_shuffle(A, A, B, bytes(|i| i ^ 1)) => "pshufb", "vpshufb", "rev16";
        vector_shuffle(A, A, B, bytes(|i| i ^ 3)) => "pshufb", "vpshufb", "rev32";
        vector_shuffle(A, A, B, bytes(|i| i ^ 7)) => "pshufb", "vpshufb", "rev64";
        vector_shuffle(D, A, B, lanes([0, Z])) => "movq", "vmovq", "fmov";
        vector_shuffle(A, A, B, lanes([1, Z])) => "psrldq", "vpsrldq", "mov";
        vector_shuffle(A, A, B, lanes([Z, 0])) => "pslldq", "vpslldq", "movi zip1";
        vector_shuffle(A, A, B, lanes([Z, 0, 1, 2])) => "pslldq", "vpslldq", "movi ext";
        vector_shuffle(D, A, B, lanes([0, Z, 1, Z])) => "pmovzxdq", "vpmovzxdq", "ushll";
        vector_shuffle(A, A, B, lanes([4, Z, 5, Z, 6, Z, 7, Z])) => "pshufb", "vpshufb", "ushll2";
        vector_shuffle(A, A, B, lanes([Z, 0, Z, 1, Z, 2, Z, 3])) => "pshufb", "vpshufb", "shll";
        vector_shuffle(A, A, B, lanes([0, 2, 4, 6, Z, Z, Z, Z])) => "pshufb", "vpshufb", "xtn";
        vector_shuffle(A, A, B, lanes([1, 3, 5, 7, Z, Z, Z, Z])) => "pshufb", "vpshufb", "shrn";
        vector_shuffle(A, A, B, lanes([1, Z, 3, Z])) => "psrlq", "vpsrlq", "ushr";
        vector_shuffle(A, A, B, lanes([Z, 0, Z, 2, Z, 4, Z, 6])) => "pslld", "vpslld", "shl";
        vector_shuffle(A, A, B, lanes([2, Z, Z, Z])) => "insertps", "vinsertps", "mov";
        vector_shuffle(A, A, B, lanes([0, 1, Z, 3])) => "pand", "vpand", "mov";
        vector_shuffle(A, A, B, lanes([0, Z, 2, Z])) => "pand", "vpand", "movi and";
    }
}

#[test]
fn shuffles_of_two_vectors() {
    const Z: u8 = ZERO;
    const ANY_BYTES: [u8; 16] = [3, 30, 9, 9, 17, 0, 31, 15, 22, 1, Z, 8, 16, 14, 25, 2];
    sequences! {
        vector_shuffle(A, A, B, lanes([0, 2])) => "punpcklqdq", "vpunpcklqdq", "zip1";
        vector_shuffle(B, A, B, lanes([0, 2])) => "movaps punpcklqdq movaps", "vpunpcklqdq", "zip1";
        vector_shuffle(B, A, B, lanes([1, 3])) => "movhlps", "vpunpckhqdq", "zip2";
        vector_shuffle(A, A, B, lanes([1, 2])) => "shufps", "vshufps", "ext";
        vector_shuffle(B, A, B, lanes([1, 2])) => "palignr", "vshufps", "ext";
        vector_shuffle(A, A, B, lanes([2, 1])) => "movsd", "vblendps", "mov";
        vector_shuffle(B, A, B, lanes([2, 1])) => "blendps", "vblendps", "mov";
        vector_shuffle(A, A, B, lanes([4, 1, 2, 3])) => "movss", "vblendps", "mov";
        vector_shuffle(A, A, B, lanes([0, 5, 2, 7])) => "blendps", "vblendps", "movi bit";
        vector_shuffle(A, A, B, lanes([0, 9, 2, 3, 4, 5, 14, 7])) => "pblendw", "vpblendw", "ldr bit";
        vector_shuffle(A, A, B, bytes(|i| i + i % 2 * 16))
            => "movaps pand pand por", "vbroadcastss vpblendvb", "movi bit";
        vector_shuffle(A, A, B, lanes([0, 7, 2, 3])) => "insertps", "vinsertps", "mov";
        vector_shuffle(A, A, B, lanes([0, 7, Z, 3])) => "insertps", "vinsertps", "mov mov";
        vector_shuffle(A, A, B, lanes([0, 2, 4, 6])) => "shufps", "vshufps", "uzp1";
        vector_shuffle(A, A, B, lanes([1, 0, 5, 4])) => "shufps", "vshufps", "zip1 rev64";
        vector_shuffle(A, A, B, lanes([1, 2, 4, 5])) => "shufps", "vshufps", "ext zip1";
        vector_shuffle(A, A, B, lanes([0, 2, 5, 6])) => "shufps", "vshufps", "uzp1 mov";
        vector_shuffle(A, A, B, lanes([0, 0, 1, 4])) => "punpcklqdq pshufd", "vpunpcklqdq vpshufd", "zip1 mov";
        vector_shuffle(A, A, B, lanes([0, 4, 2, 6])) => "pshufd blendps", "vpshufd vblendps", "trn1";
        vector_shuffle(A, A, B, lanes([1, 5, 3, 7])) => "pshufd blendps", "vpshufd vblendps", "trn2";
        vector_shuffle(A, A, B, lanes([3, 6, 1, 4])) => "blendps pshufd", "vblendps vpshufd", "ext ext trn1";
        vector_shuffle(A, A, B, lanes([0, 8, 2, 10, 4, 12, 6, 14]))
            => "movaps pslld pblendw", "vpslld vpblendw", "trn1";
        vector_shuffle(A, A, B, lanes([0, 2, 4, 6, 8, 10, 12, 14]))
            => "movaps pand pand packusdw", "vpand vpand vpackusdw", "uzp1";
        vector_shuffle(A, A, B, bytes(|i| 2 * i + 1))
            => "movaps psrlw psrlw packuswb", "vpsrlw vpsrlw vpackuswb", "uzp2";
        vector_shuffle(A, A, B, bytes(|i| i % 2 * 16 + (i & !1)))
            => "movaps psllw pand por", "vpsllw vpand vpor", "trn1";
        vector_shuffle(A, A, B, bytes(|i| i % 2 * 16 + i / 2)) => "punpcklbw", "vpunpcklbw", "zip1";
        vector_shuffle(B, A, B, bytes(|i| i + 3)) => "palignr", "vpalignr", "ext";
        vector_shuffle(B, A, B, bytes(|i| 26 - i)) => "palignr pshufb", "vpalignr vpshufb", "ext ldr tbl";
        vector_shuffle(A, A, B, bytes(|i| if i % 3 == 0 { 31 - i } else { i }))
            => "movaps pshufb pand por", "vpshufb vpand vpor", "ldr tbx";
        vector_shuffle(A, A, B, ANY_BYTES) => "movaps pshufb pshufb por", "vpshufb vpshufb vpor", "mov mov ldr tbl";
        vector_shuffle(A, A, AFTER_A, ANY_BYTES) => "movaps pshufb pshufb por", "vpshufb vpshufb vpor", "ldr tbl";
        vector_shuffle(A, AFTER_A, A, ANY_BYTES) => "movaps pshufb pshufb por", "vpshufb vpshufb vpor", "ldr tbl";
    }
}

/// How many instructions there are, and how many of them load a constant, with the destination where it is best.
fn totals<M: VectorAssembly + 'static>(
    features: M::Features,
    arguments: &[&str],
) -> Option<(usize, usize)> {
    let random = &mut vectors::Random(1);
    let patterns = [
        shuffles::with_names(),
        shuffles::of_wide_lanes(),
        shuffles::near_names(1000, random),
        shuffles::random(1000, random),
    ];
    let cases = patterns.into_iter().flatten().map(|pattern| -> Emit<M> {
        let reuse = M::reuse_for_shuffle(features, pattern);
        let places = [(Reuse::FIRST, A), (Reuse::SECOND, B), (Reuse::empty(), D)];
        let (_, dst) = places
            .into_iter()
            .find(|&(place, _)| reuse.contains(place))
            .unwrap();
        Box::new(move |masm| {
            let (gprs, fprs) = ([None; 2], [Some(C), None]);
            masm.set_scratch(Scratch { gprs, fprs });
            masm.vector_shuffle(dst, A, B, pattern);
        })
    });
    let listings = listings(features, arguments, &cases.collect::<Vec<_>>())?;
    let lines = || listings.iter().flatten();
    let loads = |line: &&String| line.contains("[rip") || line.starts_with("ldr");
    Some((lines().count(), lines().filter(loads).count()))
}

#[test]
fn totals_for_shuffles() {
    let avx2 = X64Features::AVX | X64Features::AVX2;
    let actual = [
        totals::<x64::MacroAssembler>(X64Features::empty(), &INTEL),
        totals::<x64::MacroAssembler>(avx2, &INTEL),
        totals::<arm64::MacroAssembler>(Arm64Features::empty(), &support::ARM64),
    ];
    let known = [(20680, 5998), (19783, 5958), (27666, 7024)].map(Some);
    assert!(actual == known || actual == [None; 3], "{actual:?}");
}
