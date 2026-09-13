//! Tests for alloca and variable length arrays, computed goto, `_Complex` and `__int128`.

use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, checked_for, has};
use crate::{compile, disassemble};

// ───────────────────────────── alloca and VLAs ─────────────────────────────

#[test]
fn leaving_a_vla_scope_releases_the_stack() {
    let text = disassemble(
        &compile(
            b"int f(int n) { int s = 0; for (int i = 0; i < n; i++) { int a[n]; a[0] = i; if (i == 3) continue; s += a[0]; } return s; }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    let count = |needle: &str| {
        (0..text.len())
            .filter(|&i| text[i..].starts_with(needle))
            .count()
    };
    // One save per iteration; a restore on the fallthrough and one on the `continue`.
    assert_eq!(
        (
            count("StackSave"),
            count("StackAlloc"),
            count("StackRestore")
        ),
        (1, 1, 2),
        "{text}"
    );
}

// ───────────────────────────── computed goto ─────────────────────────────

#[test]
fn computed_goto_bytecode_interpreter() {
    let bir = compile(
        b"int f(int i) { static void *t[] = { &&a, &&b }; goto *t[i]; a: return 1; b: return 2; }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    let text = disassemble(&bir).unwrap();
    // The table is plain data (1 and 2), and the jump is a Switch over both labels.
    assert!(
        has(&text, "1 => block") && has(&text, "2 => block") && !has(&text, "reloc"),
        "{text}"
    );
}

// ───────────────────────────── _Complex ─────────────────────────────

#[test]
fn complex_abi() {
    use crate::tests_phase4::abi_of;
    let d = "double _Complex f(double _Complex a, int n, double _Complex b);";
    assert_eq!(
        abi_of(d, LINUX_X64),
        "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}, i32, {f64:8@0 f64:8@8}"
    );
    assert_eq!(
        abi_of(d, LINUX_ARM64),
        "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}, i32, {f64:8@0 f64:8@8}"
    );
    assert_eq!(abi_of(d, WINDOWS_X64), "sret <- ref, i32, ref");
    let s = "float _Complex f(float _Complex a);";
    assert_eq!(abi_of(s, LINUX_X64), "{f64:8@0} <- {f64:8@0}");
    assert_eq!(
        abi_of(s, LINUX_ARM64),
        "{f32:4@0 f32:4@4} <- {f32:4@0 f32:4@4}"
    );
    assert_eq!(abi_of(s, WINDOWS_X64), "{i64:8@0} <- {i64:8@0}");
}

// ───────────────────────────── __int128 ─────────────────────────────

#[test]
fn int128_abi_varargs_and_diagnostics() {
    use crate::tests_phase4::abi_of;
    let f = "__int128 f(int a, __int128 b, unsigned __int128 c);";
    assert_eq!(
        abi_of(f, LINUX_X64),
        "{i64:8@0 i64:8@8} <- i32, {i64:8@0 i64:8@8}, {i64:8@0 i64:8@8}"
    );
    // AAPCS64 starts a 16-byte aligned value at an even register.
    assert_eq!(
        abi_of(f, LINUX_ARM64),
        "{i64:8@0 i64:8@8} <- i32, {i64:0@0 i64:8@0 i64:8@8}, {i64:8@0 i64:8@8}"
    );
    assert_eq!(abi_of(f, WINDOWS_X64), "sret <- i32, ref, ref");
    let src = "#include <stdarg.h>
         typedef __int128 s128;
         static s128 sum(int n, ...) {
             va_list ap; va_start(ap, n);
             s128 total = 0;
             for (int i = 0; i < n; i++) { total += va_arg(ap, s128); total += va_arg(ap, int); }
             va_end(ap);
             return total;
         }
         unsigned long long run(int part) {
             s128 big = (s128)1 << 100;
             s128 t = sum(5, big, 1, (s128)-7, 2, big, 3, (s128)40, 4, (s128)1, 5);
             return part ? (unsigned long long)(t >> 64) : (unsigned long long)t;
         }";
    // The one va_list no test machine has (the others run fixtures/int128/int128-abi-varargs-and-diagnostics-1).
    checked_for(src, LINUX_ARM64);
    let text = disassemble(
        &compile(
            b"__int128 f(__int128 a, __int128 b) { return a / b; }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(has(&text, "__divti3"), "{text}");
}

#[test]
fn stack_instruction_encodings() {
    let bir = compile(
        b"void *alloca(unsigned long); int f(int n) { int r; { int a[n]; a[0] = 1; char *p = alloca(64); p[0] = 2; r = a[0] + p[0]; } return r; }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    let contains = |needle: &[u8]| (0..bir.len()).any(|i| bir[i..].starts_with(needle));
    // StackSave; StackAlloc v, align 16; StackRestore v.
    assert!(contains(&[0x58]) && contains(&[0x59]), "{bir:?}");
    let text = disassemble(&bir).unwrap();
    assert!(has(&text, "StackAlloc") && has(&text, "align 16"), "{text}");
    // StackAlloc: value, then the alignment as a varuint.
    assert!(contains(&[0x57, 6, 16]), "{bir:?}");
}
