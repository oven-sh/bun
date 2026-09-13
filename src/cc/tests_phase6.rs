//! Tests for alloca and variable length arrays, computed goto, `_Complex` and `__int128`.

use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, assert_error, checked, checked_for, has};
use crate::{compile, disassemble};

// ───────────────────────────── alloca and VLAs ─────────────────────────────

#[test]
fn alloca_in_its_spellings() {
    checked(
        "extern void *alloca(unsigned long size);
         int fill(int n) {
             char *p = alloca(n);
             int *q = __builtin_alloca(n * sizeof(int));
             long *aligned = __builtin_alloca_with_align(64, 512);
             for (int i = 0; i < n; i++) { p[i] = (char)i; q[i] = i * i; }
             aligned[0] = ((unsigned long)aligned & 63) == 0;
             return p[n - 1] + q[n - 1] + (int)aligned[0] * 1000 + (((unsigned long)p & 15) == 0) * 10000;
         }
         int grows(int rounds) {
             int total = 0;
             for (int i = 0; i < rounds; i++) { int *cell = alloca(sizeof(int)); *cell = i; total += *cell; }
             return total;
         }",
    );
    // A program's own function of that name is just a function.
    checked(
        "static int calls; void *alloca(unsigned long n) { calls += (int)n; return 0; }
         int f(void) { alloca(5); alloca(6); return calls; }",
    );
    assert_error("void *p = alloca(4);", "");
}

#[test]
fn leaving_a_vla_scope_releases_the_stack() {
    checked(
        "int loop(int rounds, int n) {
             int checksum = 0;
             for (int i = 0; i < rounds; i++) {
                 char buffer[n];
                 buffer[0] = (char)i; buffer[n - 1] = 1;
                 if (i % 3 == 0) continue;
                 if (i == rounds - 1) break;
                 checksum += buffer[0] + buffer[n - 1];
             }
             return checksum;
         }
         int nested(int n) {
             int total = 0;
             for (int i = 0; i < 1000; i++) {
                 int outer[n];
                 outer[0] = i;
                 {
                     int inner[n * 2];
                     inner[1] = 2;
                     if (i & 1) goto next;
                     total += inner[1];
                 }
                 total += outer[0];
             next:;
             }
             return total;
         }
         int retry(int n) {
             int attempts = 0;
         again:;
             { long scratch[n]; scratch[n - 1] = attempts; attempts++; if (attempts < 500) goto again; return (int)scratch[n - 1]; }
         }
         int in_switch(int k, int n) {
             int r = 0;
             for (int i = 0; i < 300; i++) {
                 switch (k) { case 1: { int a[n]; a[0] = 5; r += a[0]; break; } default: { int b[n]; b[0] = 1; r += b[0]; } }
             }
             return r;
         }
         extern void *alloca(unsigned long);
         int alloca_inside(int n) {
             int s = 0;
             for (int i = 0; i < 2000; i++) { char tag[n]; char *p = alloca(256); p[0] = tag[0] = (char)i; s += p[0] == tag[0]; }
             return s;
         }",
    );
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

#[test]
fn vla_diagnostics() {
    assert_error("int n = 3; int a[n];", "file scope");
    assert_error("void f(int n) { static int a[n]; }", "automatic storage");
    assert_error("void f(int n) { extern int a[n]; }", "automatic storage");
    assert_error("void f(int n) { int a[n] = {0}; }", "cannot be initialized");
    assert_error("void f(int n) { struct S { int a[n]; } s; }", "");
    assert_error("void f(int n) { int a[*]; }", "'[*]'");
    assert_error(
        "int f(int n) { goto inside; { int a[n]; inside: a[0] = 1; return a[0]; } }",
        "goto into the scope of a variable length array",
    );
    assert_error(
        "int f(int n) { { int a[n]; a[0] = 0; mid: a[0]++; } goto mid; }",
        "goto into the scope of a variable length array",
    );
    assert_error(
        "int f(int n, int k) { switch (k) { int a[n]; case 1: a[0] = 1; return a[0]; } return 0; }",
        "switch jumps into the scope of a variable length array",
    );
    // A label ahead of the declaration in the same block is outside the array's scope.
    checked(
        "int f(int n) { int tries = 0; { again: tries++; int a[n]; a[0] = tries; if (a[0] < 3) goto again; } return tries; }",
    );
}

// ───────────────────────────── computed goto ─────────────────────────────

#[test]
fn computed_goto_bytecode_interpreter() {
    checked(
        "enum { PUSH, ADD, MUL, DUP, JNZ, DEC, SWAP, HALT };
         long run(const signed char *code) {
             static void *const dispatch[] = { &&op_push, &&op_add, &&op_mul, &&op_dup, &&op_jnz, &&op_dec, &&op_swap, &&op_halt };
             long stack[16];
             int sp = 0;
             const signed char *pc = code;
         #define NEXT goto *dispatch[*pc++]
             NEXT;
         op_push: stack[sp++] = *pc++; NEXT;
         op_add: sp--; stack[sp - 1] += stack[sp]; NEXT;
         op_mul: sp--; stack[sp - 1] *= stack[sp]; NEXT;
         op_dup: stack[sp] = stack[sp - 1]; sp++; NEXT;
         op_jnz: { int offset = *pc++; if (stack[--sp]) pc += offset; } NEXT;
         op_dec: stack[sp - 1]--; NEXT;
         op_swap: { long t = stack[sp - 1]; stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t; } NEXT;
         op_halt: return stack[sp - 1];
         }
         /* Offsets from a base label: the table holds plain integers. */
         int relative(int which) {
             static const int offsets[] = { &&first - &&first, &&second - &&first, &&third - &&first };
             void *target = &&first + offsets[which];
             goto *target;
         first: return 10;
         second: return 20;
         third: return 30;
         }
         int local_table(int i) {
             void *table[2] = { &&zero, &&one };
             void *chosen = table[i & 1];
             if (chosen == &&zero && i == 2) chosen = &&one;
             goto *chosen;
         zero: return 100;
         one: return 200;
         }",
    );
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
    assert_error("void f(void) { goto *&&missing; }", "undeclared label");
    assert_error(
        "void f(int n) { void *p = &&l; { int a[n]; l: a[0] = 0; } goto *p; }",
        "computed goto",
    );
    assert_error("void f(void) { goto *1.5; }", "pointer");
}

// ───────────────────────────── _Complex ─────────────────────────────

#[test]
fn complex_arithmetic() {
    assert_error(
        "double _Complex z; int f(void) { return z < z; }",
        "invalid operands",
    );
    assert_error(
        "double _Complex z; void *f(void) { return (void *)z; }",
        "cannot convert",
    );
    // long double _Complex stays declarable only, where long double is wider than double.
    assert_error(
        "long double _Complex z; double f(void) { return __real__ z; }",
        "long double _Complex",
    );
}

#[test]
fn complex_abi_and_libm() {
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
    if !std::path::Path::new("/usr/include/complex.h").exists() {
        return;
    }
    let src = b"#include <complex.h>
        #include <math.h>
        double magnitude(double re, double im) { double complex z = re + im * I; return cabs(z); }
        double euler(void) { double complex z = cexp(I * M_PI); return creal(z) * 1000 + fabs(cimag(z)) * 1e6 < 1 ? creal(z) : 99; }
        double conjugate(double re, double im) { double complex z = conj(re + im * I); return creal(z) * 100 + cimag(z); }
        float single(float re, float im) { float complex z = conjf(re + im * I); return cabsf(z) + cimagf(z) * 100 + crealf(z) * 10000; }
        double root(void) { double complex r = csqrt(-4.0 + 0.0 * I); return creal(r) * 10 + cimag(r); }
        int is_complex(void) { return sizeof(_Complex_I) == sizeof(float complex) && cimagf(_Complex_I) == 1.0f; }";
    let options = crate::CompileOptions {
        system_include_dirs: crate::default_system_include_dirs(LINUX_X64),
        file_provider: &crate::HostFiles,
        ..crate::CompileOptions::new(LINUX_X64)
    };
    let bir = match crate::compile_with(src, "libm.c", &options) {
        Ok(bir) => bir,
        Err(d) => panic!("{}", d[0]),
    };
    crate::validate(&bir).expect("validate");
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
    // Every target's va_list.
    checked_for(src, LINUX_X64);
    for target in [LINUX_ARM64, WINDOWS_X64] {
        checked_for(src, target);
    }
    assert_error(
        "__int128 x; int f(void) { switch (x) { case 1: return 1; } return 0; }",
        "128-bit",
    );
    assert_error("struct S { __int128 x : 3; };", "bit-field");
    assert_error(
        "typedef __int128 V __attribute__((vector_size(16)));",
        "invalid vector element type",
    );
    assert_error(
        "_Atomic __int128 x; __int128 f(void) { return x; }",
        "there are no 16-byte atomic operations",
    );
    assert_error(
        "int g(void); __int128 x = (__int128)1 << 100 | g();",
        "compile-time constant",
    );
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
fn stack_instruction_encodings_and_libc_alloca() {
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
    if !std::path::Path::new("/usr/include/alloca.h").exists() {
        return;
    }
    let options = crate::CompileOptions {
        system_include_dirs: crate::default_system_include_dirs(LINUX_X64),
        file_provider: &crate::HostFiles,
        ..crate::CompileOptions::new(LINUX_X64)
    };
    let src = b"#include <alloca.h>
        #include <stdlib.h>
        #include <string.h>
        int f(int n) { char *p = alloca(n); memset(p, 7, n); int *q = (int *)alloca(sizeof(int) * 2); q[1] = 5; return p[n - 1] + q[1]; }";
    let bir = match crate::compile_with(src, "a.c", &options) {
        Ok(bir) => bir,
        Err(d) => panic!("{}", d[0]),
    };
    let text = disassemble(&bir).unwrap();
    assert!(has(&text, "StackAlloc") && !has(&text, "alloca"), "{text}");
}
