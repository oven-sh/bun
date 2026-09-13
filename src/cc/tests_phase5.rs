//! Tests for 128-bit vectors (the GCC/Clang vector extensions and the intrinsic headers).

use crate::tests::{
    LINUX_ARM64, LINUX_X64, WINDOWS_X64, assert_error, checked, checked_for, error_for, has,
};
use crate::tests_phase4::abi_of;
use crate::{Arch, Os, Target, compile, disassemble};

const MAC_ARM64: Target = Target {
    arch: Arch::Aarch64,
    os: Os::MacOs,
};

// ───────────────────────────── helpers ─────────────────────────────

#[test]
fn one_instruction_per_lane_wise_operation() {
    let text = disassemble(
        &compile(
            b"typedef int V __attribute__((vector_size(16)));
              typedef float F __attribute__((vector_size(16)));
              V f(V a, V b, int n) { return ((a + b) * a - b / a) % b & a | b ^ ~a << n >> 2; }
              V g(V a, V b) { return (a < b) ? a : b; }
              V h(V a, V b) { return a << b; }
              F k(F a, F b) { return -a * b + 1.5f; }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    for op in [
        "VAdd i32x4",
        "VMul i32x4",
        "VSub i32x4",
        "VDiv i32x4 signed",
        "VRem i32x4 signed",
        "VAnd",
        "VOr",
        "VXor",
        "VNot",
        "VShl i32x4",
        "VShrS i32x4",
        "VLt i32x4 signed",
        "VSelect",
        "VNeg f32x4",
        "VMul f32x4",
        "VAdd f32x4",
        "ConstV128 00 00 c0 3f",
    ] {
        assert!(has(&text, op), "missing {op} in\n{text}");
    }
    // Only the vector-by-vector shift in `h` is done lane by lane.
    let count = |needle: &str| {
        (0..text.len())
            .filter(|&i| text[i..].starts_with(needle))
            .count()
    };
    assert_eq!(count("VExtract"), 8, "{text}");
    assert_eq!(count("VReplace"), 4, "{text}");
}

#[test]
fn shuffles() {
    checked(
        "typedef int V __attribute__((vector_size(16)));
         typedef unsigned char B __attribute__((vector_size(16)));
         typedef float F __attribute__((vector_size(16)));
         V reverse(V a) { return __builtin_shufflevector(a, a, 3, 2, 1, 0); }
         V interleave_low(V a, V b) { return __builtin_shufflevector(a, b, 0, 4, 1, 5); }
         V interleave_high(V a, V b) { return __builtin_shufflevector(a, b, 2, 6, 3, 7); }
         V broadcast2(V a) { return __builtin_shufflevector(a, a, 2, 2, 2, 2); }
         V blend(V a, V b) { return __builtin_shufflevector(a, b, 0, 5, 2, 7); }
         V dont_care(V a, V b) { return __builtin_shufflevector(a, b, 7, -1, -1, 4); }
         B reverse_bytes(B a) { return __builtin_shufflevector(a, a, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0); }
         F rotate(F a) { return __builtin_shufflevector(a, a, 1, 2, 3, 0); }
         V gnu_one(V a) { V m = {3, 2, 1, 0}; return __builtin_shuffle(a, m); }
         V gnu_two(V a, V b) { return __builtin_shuffle(a, b, (V){0, 4, 9, 13}); }
         V gnu_variable(V a, V m) { return __builtin_shuffle(a, m); }
         V gnu_variable_two(V a, V b, V m) { return __builtin_shuffle(a, b, m); }
         B gnu_bytes(B a, B m) { return __builtin_shuffle(a, m); }",
    );
    let text = disassemble(
        &compile(
            b"typedef int V __attribute__((vector_size(16)));
              V f(V a, V b) { return __builtin_shufflevector(a, b, 0, 5, 2, 7); }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(
        has(
            &text,
            "VShuffle v2, v3 [0 1 2 3 20 21 22 23 8 9 10 11 28 29 30 31]"
        ),
        "{text}"
    );
}

#[test]
fn conversions_and_reductions() {
    checked(
        "typedef int V __attribute__((vector_size(16)));
         typedef unsigned U __attribute__((vector_size(16)));
         typedef float F __attribute__((vector_size(16)));
         typedef long long L __attribute__((vector_size(16)));
         typedef double D __attribute__((vector_size(16)));
         typedef unsigned char B __attribute__((vector_size(16)));
         typedef short H __attribute__((vector_size(16)));
         F to_float(V v) { return __builtin_convertvector(v, F); }
         F unsigned_to_float(U v) { return __builtin_convertvector(v, F); }
         V to_int(F v) { return __builtin_convertvector(v, V); }
         U to_unsigned(F v) { return __builtin_convertvector(v, U); }
         D long_to_double(L v) { return __builtin_convertvector(v, D); }
         L double_to_long(D v) { return __builtin_convertvector(v, L); }
         U same_width(V v) { return __builtin_convertvector(v, U); }
         F reinterpret(V v) { return (F)v; }
         int sum(V v) { return __builtin_reduce_add(v); }
         int product(V v) { return __builtin_reduce_mul(v); }
         int lowest(V v) { return __builtin_reduce_min(v); }
         unsigned highest(U v) { return __builtin_reduce_max(v); }
         int all_and(V v) { return __builtin_reduce_and(v); }
         int any_or(V v) { return __builtin_reduce_or(v); }
         int parity(V v) { return __builtin_reduce_xor(v); }
         int byte_sum(B v) { return __builtin_reduce_add(v); }
         int short_min(H v) { return __builtin_reduce_min(v); }
         float fsum(F v) { return __builtin_reduce_add(v); }
         double dmax(D v) { return __builtin_reduce_max(v); }
         long long lsum(L v) { return __builtin_reduce_add(v); }
         V absolute(V v) { return __builtin_elementwise_abs(v); }
         F fabsolute(F v) { return __builtin_elementwise_abs(v); }
         V smaller(V a, V b) { return __builtin_elementwise_min(a, b); }
         U ubigger(U a, U b) { return __builtin_elementwise_max(a, b); }
         F roots(F v) { return __builtin_elementwise_sqrt(v); }
         float manual_sum(F v) { F s = v + __builtin_shufflevector(v, v, 2, 3, 0, 1); s += __builtin_shufflevector(s, s, 1, 0, 3, 2); return s[0]; }",
    );
    let text = disassemble(
        &compile(
            b"typedef int V __attribute__((vector_size(16)));
              typedef float F __attribute__((vector_size(16)));
              F f(V v) { return __builtin_convertvector(v, F); }
              int g(V v) { return __builtin_reduce_add(v); }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(has(&text, "VConvert kind 0"), "{text}");
    // Two shuffle-and-add steps, then lane 0.
    let count = |needle: &str| {
        (0..text.len())
            .filter(|&i| text[i..].starts_with(needle))
            .count()
    };
    assert_eq!(
        (count("VShuffle"), count("VAdd i32x4"), count("VExtract")),
        (2, 2, 1),
        "{text}"
    );
}

// ───────────────────────────── ABI ─────────────────────────────

#[test]
fn vector_calling_conventions() {
    let v = "typedef float V __attribute__((vector_size(16)));";
    let direct = format!("{v} V f(V a, int n, V b);");
    assert_eq!(abi_of(&direct, LINUX_X64), "v128 <- v128, i32, v128");
    assert_eq!(abi_of(&direct, LINUX_ARM64), "v128 <- v128, i32, v128");
    assert_eq!(abi_of(&direct, MAC_ARM64), "v128 <- v128, i32, v128");
    assert_eq!(abi_of(&direct, WINDOWS_X64), "v128 <- ref, i32, ref");

    let wrapped = format!("{v} struct S {{ V v; }}; struct S f(struct S a);");
    assert_eq!(abi_of(&wrapped, LINUX_X64), "{v128:16@0} <- {v128:16@0}");
    assert_eq!(abi_of(&wrapped, LINUX_ARM64), "{v128:16@0} <- {v128:16@0}");
    assert_eq!(abi_of(&wrapped, WINDOWS_X64), "sret <- ref");

    // System V merges classes per eightbyte: SSE+SSEUP only survives on its own.
    let with_floats = format!("{v} union U {{ V v; float f[4]; }}; union U f(union U a);");
    assert_eq!(
        abi_of(&with_floats, LINUX_X64),
        "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}"
    );
    let with_ints = format!("{v} union U {{ V v; int i[4]; }}; union U f(union U a);");
    assert_eq!(
        abi_of(&with_ints, LINUX_X64),
        "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}"
    );
    assert_eq!(
        abi_of(&with_ints, LINUX_ARM64),
        "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}"
    );

    let pair = format!("{v} struct S {{ V a, b; }}; struct S f(struct S a);");
    assert_eq!(abi_of(&pair, LINUX_X64), "sret <- stack(32,16)");
    assert_eq!(
        abi_of(&pair, LINUX_ARM64),
        "{v128:16@0 v128:16@16} <- {v128:16@0 v128:16@16}"
    );
    let four = format!("{v} struct S {{ V m[4]; }}; struct S f(struct S a);");
    assert_eq!(
        abi_of(&four, LINUX_ARM64),
        "{v128:16@0 v128:16@16 v128:16@32 v128:16@48} <- {v128:16@0 v128:16@16 v128:16@32 v128:16@48}"
    );
    let five = format!("{v} struct S {{ V m[5]; }}; struct S f(struct S a);");
    assert_eq!(abi_of(&five, LINUX_ARM64), "x8 <- ref");
    let mixed = format!("{v} struct S {{ V a; int tag; }}; struct S f(struct S a);");
    assert_eq!(abi_of(&mixed, LINUX_X64), "sret <- stack(32,16)");
    assert_eq!(abi_of(&mixed, LINUX_ARM64), "x8 <- ref");
}

// ───────────────────────────── intrinsic headers ─────────────────────────────

#[test]
fn neon_kernels_compile() {
    checked_for(
        "#include <arm_neon.h>
         #if !defined(__ARM_NEON) || defined(__SSE2__)
         #error feature macros
         #endif
         float dot(const float *a, const float *b, int n) {
             float32x4_t acc = vdupq_n_f32(0.0f);
             int i = 0;
             for (; i + 4 <= n; i += 4) acc = vmlaq_f32(acc, vld1q_f32(a + i), vld1q_f32(b + i));
             float total = vaddvq_f32(acc);
             for (; i < n; i++) total += a[i] * b[i];
             return total;
         }
         void clamp_bytes(uint8_t *data, int n, uint8_t lo, uint8_t hi) {
             for (int i = 0; i + 16 <= n; i += 16)
                 vst1q_u8(data + i, vminq_u8(vmaxq_u8(vld1q_u8(data + i), vdupq_n_u8(lo)), vdupq_n_u8(hi)));
         }
         int contains(const uint8_t *s, int n, uint8_t c) {
             uint8x16_t needle = vdupq_n_u8(c);
             for (int i = 0; i + 16 <= n; i += 16)
                 if (vmaxvq_u8(vceqq_u8(vld1q_u8(s + i), needle))) return 1;
             return 0;
         }
         int lanes(int x) {
             int32x4_t v = vdupq_n_s32(x);
             v = vsetq_lane_s32(7, v, 2);
             v = vaddq_s32(v, vshlq_n_s32(v, 1));
             uint32x4_t big = vcgtq_s32(v, vdupq_n_s32(20));
             int32x4_t chosen = vbslq_s32(big, vdupq_n_s32(1), vdupq_n_s32(-1));
             float32x4_t f = vcvtq_f32_s32(vshrq_n_s32(v, 1));
             int32x4_t back = vcvtq_s32_f32(vmulq_f32(f, vdupq_n_f32(1.5f)));
             uint32x4_t bits = vreinterpretq_u32_f32(vdupq_n_f32(1.0f));
             return vgetq_lane_s32(v, 0) + vgetq_lane_s32(v, 2) * 100 + vaddvq_s32(chosen) * 10000
                 + vgetq_lane_s32(back, 2) * 100000 + (int)(vgetq_lane_u32(bits, 3) >> 23) * 1000000
                 + vgetq_lane_s32(vandq_s32(veorq_s32(v, vdupq_n_s32(-1)), vorrq_s32(v, vdupq_n_s32(1))), 1) * 0;
         }",
        LINUX_ARM64,
    );
}

/// A 64-bit NEON vector is a `double`'s worth in memory and in calls; zstd's eight-byte copy is
/// one load and one store.
#[test]
fn neon_d_registers() {
    let source = "#include <arm_acle.h>
         #include <arm_neon.h>
         void copy8(void *dst, const void *src) { vst1_u8((uint8_t *)dst, vld1_u8((const uint8_t *)src)); }
         uint16x8_t widen(uint8x8_t v, uint8x16_t q) { return vaddw_u8(vmovl_u8(v), vget_high_u8(q)); }
         uint8x8x2_t halves(uint8x16_t q) { return (uint8x8x2_t){{vget_low_u8(q), vget_high_u8(q)}}; }
         uint32_t crc(uint32_t c, uint64_t x) { return __crc32d(c, x); }";
    for target in [LINUX_ARM64, MAC_ARM64] {
        let bir = compile(source.as_bytes(), "t.c", target).expect("compiles");
        let text = disassemble(&bir).expect("valid");
        assert!(has(&text, "Load f64"), "{text}");
        assert!(has(&text, "Store f64"), "{text}");
        assert!(
            has(&text, "widen (exported): sig") && has(&text, "(f64, v128) -> v128"),
            "{text}"
        );
        assert!(has(&text, "(v128) -> (f64, f64)"), "{text}");
    }
}

#[test]
fn intrinsic_headers_are_per_architecture() {
    let e = error_for("#include <emmintrin.h>\nint x;", LINUX_ARM64);
    assert!(has(&e, "emmintrin.h"), "{e}");
    let e = error_for("#include <arm_neon.h>\nint x;", LINUX_X64);
    assert!(has(&e, "arm_neon.h"), "{e}");
    // Every intrinsic body type-checks on every target of its architecture.
    for target in [LINUX_X64, WINDOWS_X64] {
        compile(
            b"#include <immintrin.h>\nint f(void) { return 0; }",
            "t.c",
            target,
        )
        .expect("x86 headers");
    }
    for target in [LINUX_ARM64, MAC_ARM64] {
        compile(
            b"#include <arm_neon.h>\n#include <arm_acle.h>\nint f(void) { return 0; }",
            "t.c",
            target,
        )
        .expect("neon header");
    }
}

// ───────────────────────────── diagnostics ─────────────────────────────

#[test]
fn vector_diagnostics() {
    // Other sizes can be named, but not used.
    checked(
        "typedef float v2f __attribute__((vector_size(8)));
         typedef int v8i __attribute__((vector_size(32)));
         typedef float v16f __attribute__((__vector_size__(64)));
         typedef short s2 __attribute__((ext_vector_type(2)));
         typedef float float4 __attribute__((ext_vector_type(4)));
         v2f declared_only(v2f);
         float first(float4 v) { return v[0] + sizeof(v2f) + sizeof(v8i); }",
    );
    let only = "only 8-byte and 16-byte vectors are supported yet";
    assert_error(
        "typedef float v8f __attribute__((vector_size(32))); v8f f(v8f a) { return a; }",
        only,
    );
    assert_error(
        "typedef short v2s __attribute__((vector_size(4))); short f(v2s *p) { return (*p)[0]; }",
        only,
    );
    assert_error(
        "typedef int v8i __attribute__((vector_size(32))); v8i g; int f(void) { return g[0]; }",
        only,
    );
    assert_error(
        "typedef char v4c __attribute__((vector_size(4))); v4c f(void);  int g(void) { f(); return 0; }",
        only,
    );
    assert_error(
        "typedef double v8d __attribute__((vector_size(64))); void f(void) { v8d x = {0}; }",
        only,
    );
    assert_error(
        "typedef int bad __attribute__((vector_size(12)));",
        "power of two",
    );
    assert_error(
        "typedef struct S { int x; } bad __attribute__((vector_size(16)));",
        "invalid vector element type",
    );
    assert_error(
        "typedef _Bool bad __attribute__((vector_size(16)));",
        "invalid vector element type",
    );
    let v = "typedef int V __attribute__((vector_size(16))); typedef float F __attribute__((vector_size(16)));";
    assert_error(
        &format!("{v} V f(V a, F b) {{ return a + b; }}"),
        "invalid operands",
    );
    assert_error(
        &format!("{v} F f(F a, F b) {{ return a & b; }}"),
        "invalid operands",
    );
    assert_error(&format!("{v} F f(F a) {{ return ~a; }}"), "invalid operand");
    assert_error(
        &format!("{v} F f(V a) {{ return a; }}"),
        "incompatible types",
    );
    assert_error(&format!("{v} V f(int a) {{ return (V)a; }}"), "cannot cast");
    assert_error(&format!("{v} int f(V a) {{ return a ? 1 : 2; }}"), "");
    assert_error(
        &format!("{v} int f(V a) {{ if (a) return 1; return 0; }}"),
        "scalar",
    );
    assert_error(
        &format!("{v} V f(V a) {{ return __builtin_shufflevector(a, a, 0, 1, 2, 8); }}"),
        "out of range",
    );
    assert_error(
        &format!("{v} V f(V a, int i) {{ return __builtin_shufflevector(a, a, 0, 1, 2, i); }}"),
        "constant",
    );
    assert_error(
        &format!("{v} V f(V a) {{ V v = {{1, 2, 3, 4, 5}}; return v; }}"),
        "excess elements",
    );
    assert_error(
        &format!("{v} int printf(const char *, ...); void f(V a) {{ printf(\"%d\", a); }}"),
        "variadic argument",
    );
    assert_error(
        &format!(
            "#include <stdarg.h>\n{v} V f(int n, ...) {{ va_list ap; va_start(ap, n); V v = va_arg(ap, V); va_end(ap); return v; }}"
        ),
        "va_arg",
    );
}

// ───────────────────────────── encoding ─────────────────────────────

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    (0..haystack.len()).any(|i| haystack[i..].starts_with(needle))
}

#[test]
fn vector_and_atomic_encodings_follow_the_spec() {
    let bir = compile(
        b"typedef int V __attribute__((vector_size(16)));
          V f(V a, V b, int n) {
              V c = a < b;
              c[1] = n;
              V d = __builtin_shufflevector(a, b, 0, 4, 1, 5) << n;
              return (c ? a : d) + (V){1, 2, 3, 4} + c[2];
          }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    // sig: one v128 result, not variadic, params Value v128, Value v128, Value i32.
    assert!(
        contains_bytes(&bir, &[1, 5, 0, 3, 0, 5, 0, 5, 0, 1]),
        "{bir:?}"
    );
    // VLt: lane I32x4, signed, a, b.
    assert!(contains_bytes(&bir, &[0x86, 2, 1]), "{bir:?}");
    // VReplace: lane, index 1, vector, scalar.  VExtract: lane, signed, index 2, vector.
    assert!(contains_bytes(&bir, &[0x72, 2, 1]), "{bir:?}");
    assert!(contains_bytes(&bir, &[0x71, 2, 1, 2]), "{bir:?}");
    let shuffle: Vec<u8> = vec![0, 1, 2, 3, 16, 17, 18, 19, 4, 5, 6, 7, 20, 21, 22, 23];
    assert!(contains_bytes(&bir, &shuffle), "{bir:?}");
    let constant: Vec<u8> = [0x05u8]
        .into_iter()
        .chain([1u32, 2, 3, 4].iter().flat_map(|x| x.to_le_bytes()))
        .collect();
    assert!(contains_bytes(&bir, &constant), "{bir:?}");
    // VSplat lane I32x4.
    assert!(contains_bytes(&bir, &[0x70, 2]), "{bir:?}");

    let bir = compile(
        b"int f(int *p, int *e, short *s, long long *q) {
              int old = __atomic_fetch_xor(p, 5, __ATOMIC_ACQ_REL);
              __atomic_store_n(s, 3, __ATOMIC_RELEASE);
              __atomic_thread_fence(__ATOMIC_SEQ_CST);
              old += (int)__atomic_load_n(q, __ATOMIC_ACQUIRE);
              return old + __atomic_compare_exchange_n(p, e, 9, 0, __ATOMIC_SEQ_CST, __ATOMIC_RELAXED);
          }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    // AtomicRmw: op Xor(4), kind I32(4), order AcquireRelease(3).
    assert!(contains_bytes(&bir, &[0xa2, 4, 4, 3]), "{bir:?}");
    // AtomicStore: kind I16U(3), order Release(2).
    assert!(contains_bytes(&bir, &[0xa1, 3, 2]), "{bir:?}");
    // Fence seq_cst; AtomicLoad kind I64(5) order Acquire(1); AtomicCas kind I32, orders 4 and 0.
    assert!(contains_bytes(&bir, &[0xa4, 4]), "{bir:?}");
    assert!(contains_bytes(&bir, &[0xa0, 5, 1]), "{bir:?}");
    assert!(contains_bytes(&bir, &[0xa3, 4, 4, 0]), "{bir:?}");
}
