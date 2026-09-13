//! Tests for BIR4 (now BIR6): the new integer and vector operations, thread-local storage,
//! `#pragma comment(lib, ...)`, `volatile`, and functions that call `setjmp`.

use crate::tests::{LINUX_ARM64, LINUX_X64, checked_for, has};
use crate::{CompileOptions, compile, compile_many, compile_with_warnings, disassemble, validate};

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    (0..haystack.len()).any(|i| haystack[i..].starts_with(needle))
}

fn count(text: &str, needle: &str) -> usize {
    (0..text.len())
        .filter(|&i| text[i..].starts_with(needle))
        .count()
}

fn link(units: &[(&str, &str)]) -> Result<crate::Output, String> {
    let units: Vec<(&[u8], &str)> = units
        .iter()
        .map(|(name, text)| (text.as_bytes(), *name))
        .collect();
    compile_many(&units, &CompileOptions::new(LINUX_X64)).map_err(|d| d[0].to_string())
}

// ───────────────────────────── new operations ─────────────────────────────

#[test]
fn bir4_encodings() {
    let output = compile_with_warnings(
        b"#pragma comment(lib, \"z\")
          _Thread_local int counter = 7;
          typedef unsigned __int128 u128;
          unsigned long long high(unsigned long long a, unsigned long long b) { return (unsigned long long)(((u128)a * b) >> 64); }
          int bump(void) { return ++counter; }",
        "t.c",
        &CompileOptions::new(LINUX_X64),
    )
    .unwrap_or_else(|d| panic!("{}", d[0]));
    let bir = &output.bir;
    assert!(bir.starts_with(b"BIR6"), "{bir:?}");
    // tls: size 4, align 4, one initialized byte (the rest is zero); it follows the
    // (empty) data segment.
    // (then no tls relocs)
    assert!(contains(bir, &[0, 1, 0, 0, 4, 4, 1, 7, 0]), "{bir:?}");
    // TlsAddr 0; UMulHigh.
    assert!(
        contains(bir, &[0x5a, 0]) && contains(bir, &[0x2d]),
        "{bir:?}"
    );
    // The libraries table, then the (empty) constructor and destructor tables.
    assert!(bir.ends_with(&[1, 1, b'z', 0, 0]), "{bir:?}");
    assert_eq!(output.libraries, ["z"]);
    let text = disassemble(bir).unwrap();
    assert!(
        has(&text, "UMulHigh")
            && has(&text, "TlsAddr 0")
            && has(&text, "library z")
            && has(&text, "tls: size 4 align 4"),
        "{text}"
    );
    // The high half of the product of two zero-extended halves is `UMulHigh` and nothing else.
    assert_eq!(count(&text, "Mul v"), 0, "{text}");
    validate(bir).unwrap();

    let text = disassemble(
        &compile(
            b"typedef unsigned char B __attribute__((vector_size(16)));
              typedef long long L __attribute__((vector_size(16)));
              typedef double D __attribute__((vector_size(16)));
              B pick(B a, B m) { return __builtin_shuffle(a, m); }
              B pick2(B a, B b, B m) { return __builtin_shuffle(a, b, m); }
              D widen(L v) { return __builtin_convertvector(v, D); }
              L narrow(D v) { return __builtin_convertvector(v, L); }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(count(&text, "VSwizzle"), 3, "{text}");
    assert!(
        has(&text, "VConvert kind 22") && has(&text, "VConvert kind 24"),
        "{text}"
    );
    assert_eq!(
        count(&text, "VExtract") + count(&text, "VReplace"),
        0,
        "{text}"
    );
}

#[test]
fn ssse3_and_the_new_sse2_lowerings() {
    let names = [
        "shuffle_epi8",
        "abs_epi8",
        "abs_epi16",
        "abs_epi32",
        "hadd_epi16",
        "hadd_epi32",
        "hsub_epi16",
        "hadds_epi16",
        "sign_epi8",
        "sign_epi16",
        "sign_epi32",
        "maddubs_epi16",
        "packus_epi32",
    ];
    let mut src = String::from(
        "#include <immintrin.h>
         #ifndef __SSSE3__
         #error SSSE3
         #endif
         void run(const __m128i *a, const __m128i *b, __m128i *out) {\n",
    );
    for (i, name) in names.iter().enumerate() {
        let call = if name.starts_with("abs") {
            format!("_mm_{name}(*a)")
        } else {
            format!("_mm_{name}(*a, *b)")
        };
        src.push_str(&format!("  out[{i}] = {call};\n"));
    }
    src.push_str(
        "  out[13] = _mm_alignr_epi8(*a, *b, 0); out[14] = _mm_alignr_epi8(*a, *b, 5); out[15] = _mm_alignr_epi8(*a, *b, 16);
           out[16] = _mm_alignr_epi8(*a, *b, 21); out[17] = _mm_alignr_epi8(*a, *b, 40);
         }\n",
    );
    let bir = compile(src.as_bytes(), "t.c", LINUX_X64).unwrap_or_else(|d| panic!("{}", d[0]));
    let text = disassemble(&bir).unwrap();
    for op in [
        "VSwizzle",
        "VAbs i8x16",
        "VAddSat i16x8 signed",
        "VNarrow i32x4 unsigned",
    ] {
        assert!(has(&text, op), "missing {op}\n{text}");
    }
    // The SSE2 intrinsics that used to be several operations are single ones now.
    let text = disassemble(
        &compile(
            b"#include <emmintrin.h>
              __m128i f(__m128i a, __m128i b) {
                  return _mm_adds_epu8(_mm_subs_epi16(a, b), _mm_avg_epu16(_mm_packs_epi32(a, b), _mm_madd_epi16(_mm_mulhi_epu16(a, b), b)));
              }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    for op in [
        "VAddSat i8x16 unsigned",
        "VSubSat i16x8 signed",
        "VAvgU i16x8",
        "VNarrow i32x4 signed",
        "VDot",
        "VExtMul i32x4 unsigned low",
        "VExtMul i32x4 unsigned high",
    ] {
        assert!(has(&text, op), "missing {op}\n{text}");
    }
}

#[test]
fn neon_additions() {
    checked_for(
        "#include <arm_neon.h>
         void run(const uint8_t *a, const uint8_t *b, uint8_t *out) {
             uint8x16_t x = vld1q_u8(a), y = vld1q_u8(b);
             vst1q_u8(out, vqaddq_u8(x, y));
             vst1q_u8(out + 16, vqsubq_u8(x, y));
             vst1q_s8((int8_t *)out + 32, vqaddq_s8(vreinterpretq_s8_u8(x), vreinterpretq_s8_u8(y)));
             vst1q_u8(out + 48, vrhaddq_u8(x, y));
             vst1q_u8(out + 64, vqtbl1q_u8(x, y));
             vst1q_u16((uint16_t *)(out + 80), vmull_high_u8(x, y));
             vst1q_s16((int16_t *)(out + 96), vmull_high_s8(vreinterpretq_s8_u8(x), vreinterpretq_s8_u8(y)));
             vst1q_u8(out + 112, vpaddq_u8(x, y));
             vst1q_s16((int16_t *)(out + 128), vqsubq_s16(vreinterpretq_s16_u8(x), vreinterpretq_s16_u8(y)));
         }",
        LINUX_ARM64,
    );
}

// ───────────────────────────── thread-local storage ─────────────────────────────

#[test]
fn thread_local_objects() {
    let src = "_Thread_local int counter = 5;
         static __thread long long big = -2;
         _Thread_local char name[8] = \"tls\";
         _Thread_local struct { short a; double b; } record = { 3, 1.5 };
         __thread int zeroed;
         int ordinary = 100;
         int bump(void) { counter += 2; zeroed++; return counter * 100 + zeroed; }
         long long wide(void) { return big-- + (long long)sizeof(big); }
         int text(int i) { name[3] = 'x'; return name[i]; }
         int fields(void) { record.a++; int *p = &counter; *p += 1; return record.a + (int)(record.b * 2) + *p * 10 + ordinary; }
         int per_function(void) { static _Thread_local int calls = 10; extern _Thread_local int counter; return ++calls + counter * 0; }
         int *address(void) { return &zeroed; }
         int different(void) { return (char *)&counter != (char *)&ordinary && address() == &zeroed; }";
    let text = disassemble(&compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    // Only `ordinary` is in the data segment.
    assert!(
        has(&text, "data: size 4 align 4") && has(&text, "tls: size"),
        "{text}"
    );
    assert!(has(&text, "TlsAddr") && !has(&text, "extern"), "{text}");
}

#[test]
fn thread_local_objects_across_units() {
    let output = link(&[
        ("a.c", "extern _Thread_local int shared; _Thread_local int tentative; static _Thread_local int mine = 1; int a(void) { shared += 10; tentative++; return shared + mine++; }"),
        ("b.c", "_Thread_local int shared = 5; _Thread_local int tentative; static _Thread_local int mine = 100; int b(void) { return shared * 1000 + tentative * 100000 + mine++; }"),
    ])
    .expect("link");
    validate(&output.bir).unwrap();
    let text = disassemble(&output.bir).unwrap();
    assert!(
        has(&text, "tls: size 16") && !has(&text, "extern"),
        "{text}"
    );
}

// ───────────────────────────── #pragma comment(lib) ─────────────────────────────

#[test]
fn pragma_comment_lib() {
    let src = b"#pragma comment(lib, \"z\")
        #pragma comment(lib, \"sqlite3\")
        #pragma comment(lib, \"z\")
        #pragma comment(linker, \"/export:f\")
        #pragma comment(lib)
        #pragma comment(user, \"note\")
        #pragma once
        unsigned long crc32(unsigned long, const unsigned char *, unsigned);
        unsigned long f(const unsigned char *p, unsigned n) { return crc32(0, p, n); }";
    let output = compile_with_warnings(src, "t.c", &CompileOptions::new(LINUX_X64))
        .unwrap_or_else(|d| panic!("{}", d[0]));
    assert_eq!(output.libraries, ["z", "sqlite3"]);
    let text = disassemble(&output.bir).unwrap();
    assert!(
        has(&text, "library z\nlibrary sqlite3\n") && has(&text, "extern 0: crc32"),
        "{text}"
    );

    let output = link(&[
        ("a.c", "#pragma comment(lib, \"m\")\n#pragma comment(lib, \"z\")\nint a(void) { return 1; }"),
        ("b.c", "#pragma comment(lib, \"z\")\n#pragma comment(lib, \"curl\")\nint b(void) { return 2; }"),
        ("c.c", "int c(void) { return 3; }"),
    ])
    .expect("link");
    assert_eq!(output.libraries, ["m", "z", "curl"]);
    assert_eq!(crate::export_names(&output.bir).unwrap(), ["a", "b", "c"]);
}

// ───────────────────────────── volatile and setjmp ─────────────────────────────

#[test]
fn volatile_objects_live_in_memory() {
    let text = disassemble(
        &compile(
            b"int plain(int x) { int y = x; y++; return y + y; }
              int careful(volatile int x) { volatile int y = x; y++; int *volatile p = 0; (void)p; return y + y; }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    let (plain, careful) = text.split_at(
        (0..text.len())
            .find(|&i| text[i..].starts_with("func 1 careful"))
            .expect("two functions"),
    );
    assert_eq!(count(plain, "Load") + count(plain, "slot "), 0, "{plain}");
    // The parameter, `y` and `p` are slots; `y++` is a load, an add and a store, and each
    // later read of `y` is a load of its own.
    assert_eq!(count(careful, "slot "), 3, "{careful}");
    assert!(
        count(careful, "Load volatile i32") >= 4 && count(careful, "Store volatile i32") >= 1,
        "{careful}"
    );
    assert!(!has(careful, "\n  local "), "{careful}");
}

#[test]
fn functions_that_call_setjmp_keep_their_variables_in_memory() {
    let src = "typedef long jmp_buf[32];
         int _setjmp(jmp_buf);
         void escape(jmp_buf);
         #define setjmp(env) _setjmp(env)
         int guarded(int start) {
             jmp_buf env;
             int steps = start;
             int limit = 3;
             if (setjmp(env)) return steps + limit;
             steps = steps + 1;
             escape(env);
             return -1;
         }
         int ordinary(int start) { int steps = start; steps = steps + 1; return steps; }";
    let text = disassemble(&compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    let split = (0..text.len())
        .find(|&i| text[i..].starts_with("func 1 ordinary"))
        .expect("two functions");
    let (guarded, ordinary) = text.split_at(split);
    assert!(!has(guarded, "\n  local "), "{guarded}");
    assert_eq!(count(guarded, "slot "), 4, "{guarded}");
    assert!(
        has(ordinary, "\n  local ") && !has(ordinary, "slot "),
        "{ordinary}"
    );
}
