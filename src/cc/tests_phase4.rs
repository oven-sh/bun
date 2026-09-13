//! Tests for passing and returning structs and unions by value.

use std::fmt::Write as _;

use crate::abi::{ArgPass, Piece, RetPass, lower_call};
use crate::bir::Exhausts;
use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, has};
use crate::{Arch, Os, Target, compile, disassemble, parse_for_tests};

const MAC_ARM64: Target = Target {
    arch: Arch::Aarch64,
    os: Os::MacOs,
};

fn pieces_text(pieces: &[Piece]) -> String {
    let mut out = String::from("{");
    for (i, p) in pieces.iter().enumerate() {
        let _ = write!(
            out,
            "{}{}:{}@{}",
            if i > 0 { " " } else { "" },
            p.ty.name(),
            p.bytes,
            p.offset
        );
    }
    out.push('}');
    out
}

/// How `f` in `src` is called on `target`: "ret <- arg, arg, ...".
pub(crate) fn abi_of(src: &str, target: Target) -> String {
    let program = parse_for_tests(src, target);
    let f = program
        .funcs
        .iter()
        .find(|f| &*f.name == "f")
        .expect("a function named f");
    let abi = lower_call(&program.tcx, &f.ty.ret, &f.ty.params, f.ty.params.len())
        .expect("classification");
    let mut out = match &abi.ret {
        RetPass::Void => "void".to_string(),
        RetPass::Scalar(t) => t.name().to_string(),
        RetPass::Pieces(p) => pieces_text(p),
        RetPass::HiddenPointer => "sret".to_string(),
        RetPass::Indirect => "x8".to_string(),
        RetPass::X87 => "st0".to_string(),
    };
    out.push_str(" <-");
    for (i, arg) in abi.args.iter().enumerate() {
        out.push_str(if i > 0 { ", " } else { " " });
        match arg {
            ArgPass::Scalar(t) => out.push_str(t.name()),
            ArgPass::Pieces(p) => out.push_str(&pieces_text(p)),
            ArgPass::Stack {
                size,
                align,
                exhausts,
            } => {
                let _ = write!(out, "stack({size},{align}");
                match exhausts {
                    Exhausts::Nothing => {}
                    Exhausts::IntegerRegisters => out.push_str(",int"),
                    Exhausts::FloatRegisters => out.push_str(",float"),
                }
                out.push(')');
            }
            ArgPass::Reference => out.push_str("ref"),
            ArgPass::Ignore => out.push_str("none"),
        }
    }
    out
}

/// The same struct passed and returned.
fn round_trip(body: &str, target: Target) -> String {
    abi_of(
        &format!("struct T {{ {body} }}; struct T f(struct T a);"),
        target,
    )
}

#[test]
fn abi_classification_tables() {
    // (members, x86-64 System V, AAPCS64, Win64): "result <- argument".
    let table: &[(&str, &str, &str, &str)] = &[
        (
            "int a;",
            "{i32:4@0} <- {i32:4@0}",
            "{i32:4@0} <- {i32:4@0}",
            "{i32:4@0} <- {i32:4@0}",
        ),
        (
            "char a;",
            "{i32:1@0} <- {i32:1@0}",
            "{i32:1@0} <- {i32:1@0}",
            "{i32:1@0} <- {i32:1@0}",
        ),
        (
            "short a; char b;",
            "{i32:4@0} <- {i32:4@0}",
            "{i32:4@0} <- {i32:4@0}",
            "{i32:4@0} <- {i32:4@0}",
        ),
        (
            "int a, b;",
            "{i64:8@0} <- {i64:8@0}",
            "{i64:8@0} <- {i64:8@0}",
            "{i64:8@0} <- {i64:8@0}",
        ),
        (
            "long long a, b;",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "sret <- ref",
        ),
        (
            "long long a, b, c;",
            "sret <- stack(24,8)",
            "x8 <- ref",
            "sret <- ref",
        ),
        (
            "double a;",
            "{f64:8@0} <- {f64:8@0}",
            "{f64:8@0} <- {f64:8@0}",
            "{i64:8@0} <- {i64:8@0}",
        ),
        (
            "float a;",
            "{f32:4@0} <- {f32:4@0}",
            "{f32:4@0} <- {f32:4@0}",
            "{i32:4@0} <- {i32:4@0}",
        ),
        (
            "float a, b;",
            "{f64:8@0} <- {f64:8@0}",
            "{f32:4@0 f32:4@4} <- {f32:4@0 f32:4@4}",
            "{i64:8@0} <- {i64:8@0}",
        ),
        (
            "float a, b, c;",
            "{f64:8@0 f32:4@8} <- {f64:8@0 f32:4@8}",
            "{f32:4@0 f32:4@4 f32:4@8} <- {f32:4@0 f32:4@4 f32:4@8}",
            "sret <- ref",
        ),
        (
            "float a, b, c, d;",
            "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}",
            "{f32:4@0 f32:4@4 f32:4@8 f32:4@12} <- {f32:4@0 f32:4@4 f32:4@8 f32:4@12}",
            "sret <- ref",
        ),
        (
            "double a, b;",
            "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}",
            "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}",
            "sret <- ref",
        ),
        (
            "double a, b, c;",
            "sret <- stack(24,8)",
            "{f64:8@0 f64:8@8 f64:8@16} <- {f64:8@0 f64:8@8 f64:8@16}",
            "sret <- ref",
        ),
        (
            "int a; double b;",
            "{i64:8@0 f64:8@8} <- {i64:8@0 f64:8@8}",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "sret <- ref",
        ),
        (
            "double a; int b;",
            "{f64:8@0 i64:8@8} <- {f64:8@0 i64:8@8}",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "sret <- ref",
        ),
        (
            "float a; int b;",
            "{i64:8@0} <- {i64:8@0}",
            "{i64:8@0} <- {i64:8@0}",
            "{i64:8@0} <- {i64:8@0}",
        ),
        (
            "char a[3];",
            "{i32:3@0} <- {i32:3@0}",
            "{i32:3@0} <- {i32:3@0}",
            "sret <- ref",
        ),
        (
            "char a[16];",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "sret <- ref",
        ),
        (
            "char a[17];",
            "sret <- stack(24,8)",
            "x8 <- ref",
            "sret <- ref",
        ),
        (
            "int a, b, c;",
            "{i64:8@0 i32:4@8} <- {i64:8@0 i32:4@8}",
            "{i64:8@0 i32:4@8} <- {i64:8@0 i32:4@8}",
            "sret <- ref",
        ),
        (
            "struct { int x, y; } in; double d;",
            "{i64:8@0 f64:8@8} <- {i64:8@0 f64:8@8}",
            "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}",
            "sret <- ref",
        ),
        (
            "double a[2];",
            "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}",
            "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}",
            "sret <- ref",
        ),
        (
            "struct { float x, y; } p[2];",
            "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}",
            "{f32:4@0 f32:4@4 f32:4@8 f32:4@12} <- {f32:4@0 f32:4@4 f32:4@8 f32:4@12}",
            "sret <- ref",
        ),
        (
            "unsigned a : 3; unsigned b : 20; short c;",
            "{i64:8@0} <- {i64:8@0}",
            "{i64:8@0} <- {i64:8@0}",
            "",
        ),
        // (A structure with no members takes four bytes in Microsoft C.)
        ("", "void <- none", "void <- none", "{i32:4@0} <- {i32:4@0}"),
    ];
    for (members, sysv, aapcs, win) in table {
        assert_eq!(round_trip(members, LINUX_X64), *sysv, "System V: {members}");
        assert_eq!(
            round_trip(members, LINUX_ARM64),
            *aapcs,
            "AAPCS64 Linux: {members}"
        );
        assert_eq!(
            round_trip(members, MAC_ARM64),
            *aapcs,
            "AAPCS64 Apple: {members}"
        );
        if !win.is_empty() {
            assert_eq!(round_trip(members, WINDOWS_X64), *win, "Win64: {members}");
        }
    }
    // Packed members make System V use memory; unions merge their members' classes.
    let packed = "struct __attribute__((packed)) T { char c; int i; }; struct T f(struct T a);";
    assert_eq!(abi_of(packed, LINUX_X64), "sret <- stack(8,8)");
    assert_eq!(abi_of(packed, LINUX_ARM64), "{i64:5@0} <- {i64:5@0}");
    assert_eq!(abi_of(packed, WINDOWS_X64), "sret <- ref");
    let int_float = "union T { int i; float f; }; union T f(union T a);";
    assert_eq!(abi_of(int_float, LINUX_X64), "{i32:4@0} <- {i32:4@0}");
    assert_eq!(abi_of(int_float, LINUX_ARM64), "{i32:4@0} <- {i32:4@0}");
    let long_double = "union T { long long l; double d; }; union T f(union T a);";
    assert_eq!(abi_of(long_double, LINUX_X64), "{i64:8@0} <- {i64:8@0}");
    assert_eq!(abi_of(long_double, WINDOWS_X64), "{i64:8@0} <- {i64:8@0}");
    let floats = "union T { float f; float g[2]; }; union T f(union T a);";
    assert_eq!(abi_of(floats, LINUX_X64), "{f64:8@0} <- {f64:8@0}");
    assert_eq!(
        abi_of(floats, LINUX_ARM64),
        "{f32:4@0 f32:4@4} <- {f32:4@0 f32:4@4}"
    );
}

#[test]
fn abi_register_accounting() {
    let pair =
        "struct P { long long a, b; }; struct D { double a, b; }; struct H { double a, b, c; };";
    // System V: a struct goes to memory whole when its registers are not all free; later scalars still use what is left.
    assert_eq!(
        abi_of(
            &format!("{pair} int f(int a, int b, int c, int d, int e, struct P p, int g);"),
            LINUX_X64
        ),
        "i32 <- i32, i32, i32, i32, i32, stack(16,8), i32"
    );
    assert_eq!(
        abi_of(
            &format!("{pair} int f(int a, int b, int c, int d, struct P p, int g);"),
            LINUX_X64
        ),
        "i32 <- i32, i32, i32, i32, {i64:8@0 i64:8@8}, i32"
    );
    assert_eq!(
        abi_of(
            &format!(
                "{pair} int f(double a, double b, double c, double d, double e, double f6, double g, struct D p, double h);"
            ),
            LINUX_X64
        ),
        "i32 <- f64, f64, f64, f64, f64, f64, f64, stack(16,8), f64"
    );
    // The hidden result pointer uses the first integer register.
    assert_eq!(
        abi_of(
            &format!("{pair} struct H f(int a, int b, int c, int d, struct P p);"),
            LINUX_X64
        ),
        "sret <- i32, i32, i32, i32, stack(16,8)"
    );
    // AAPCS64: running out closes that register class to later arguments.
    assert_eq!(
        abi_of(
            &format!(
                "{pair} int f(int a, int b, int c, int d, int e, int f6, int g, struct P p, int h);"
            ),
            LINUX_ARM64
        ),
        "i32 <- i32, i32, i32, i32, i32, i32, i32, stack(16,8,int), i32"
    );
    assert_eq!(
        abi_of(
            &format!(
                "{pair} int f(double a, double b, double c, double d, double e, double f6, struct H p, double h);"
            ),
            LINUX_ARM64
        ),
        "i32 <- f64, f64, f64, f64, f64, f64, stack(24,8,float), f64"
    );
    assert_eq!(
        abi_of(
            &format!("{pair} struct H f(struct H a, struct P b);"),
            LINUX_ARM64
        ),
        "{f64:8@0 f64:8@8 f64:8@16} <- {f64:8@0 f64:8@8 f64:8@16}, {i64:8@0 i64:8@8}"
    );
    // A 16-byte-aligned composite starts at an even register: x1 is skipped.
    let aligned =
        "struct A { long long a, b; } __attribute__((aligned(16))); int f(int n, struct A a);";
    assert_eq!(
        abi_of(aligned, LINUX_ARM64),
        "i32 <- i32, {i64:0@0 i64:8@0 i64:8@8}"
    );
    // Large composites go by reference on AArch64 and Win64, in memory on System V.
    let big = "struct B { char bytes[64]; }; struct B f(struct B a, int n);";
    assert_eq!(abi_of(big, LINUX_X64), "sret <- stack(64,8), i32");
    assert_eq!(abi_of(big, LINUX_ARM64), "x8 <- ref, i32");
    assert_eq!(abi_of(big, WINDOWS_X64), "sret <- ref, i32");
    // An aggregate with an x87 `long double` in it is in memory, except the one that is nothing
    // else, which comes back on the x87 stack.
    let with_long_double = "struct L { long double x; int n; }; struct L f(struct L a, int n);";
    assert_eq!(
        abi_of(with_long_double, LINUX_X64),
        "sret <- stack(32,16), i32"
    );
    let mixed = "union U { long double x; int n; }; union U f(union U a, long double b);";
    assert_eq!(
        abi_of(mixed, LINUX_X64),
        "sret <- stack(16,16), stack(16,16)"
    );
    let scalar = "long double f(long double a, double b, long double c);";
    assert_eq!(
        abi_of(scalar, LINUX_X64),
        "st0 <- stack(16,16), f64, stack(16,16)"
    );
    let only = "struct L { long double x; }; struct L f(struct L a);";
    assert_eq!(abi_of(only, LINUX_X64), "st0 <- stack(16,16)");
    let quad = crate::tests::error_for(
        "struct L { long double x; }; struct L f(void) { struct L l; return l; }",
        LINUX_ARM64,
    );
    assert!(has(&quad, "contains 'long double'"), "{quad}");
}

/// An 8-byte vector is one SSE eightbyte on System V, a short vector on AArch64 (where a struct
/// of them is homogeneous only with its own kind), and an integer on x64 Windows.
#[test]
fn eight_byte_vectors_in_calls() {
    let plain = "typedef unsigned char v __attribute__((vector_size(8))); v f(v a, int n, v b);";
    assert_eq!(abi_of(plain, LINUX_X64), "f64 <- f64, i32, f64");
    assert_eq!(abi_of(plain, LINUX_ARM64), "f64 <- f64, i32, f64");
    assert_eq!(abi_of(plain, MAC_ARM64), "f64 <- f64, i32, f64");
    assert_eq!(abi_of(plain, WINDOWS_X64), "i64 <- i64, i32, i64");
    let pair = "typedef int v __attribute__((vector_size(8))); typedef float w __attribute__((vector_size(8)));
        struct P { v a; w b; }; struct P f(struct P p);";
    assert_eq!(
        abi_of(pair, LINUX_X64),
        "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}"
    );
    assert_eq!(
        abi_of(pair, LINUX_ARM64),
        "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}"
    );
    assert_eq!(abi_of(pair, WINDOWS_X64), "sret <- ref");
    let with_int = "typedef short v __attribute__((vector_size(8))); struct P { int n; v a; }; struct P f(struct P p);";
    assert_eq!(
        abi_of(with_int, LINUX_X64),
        "{i64:8@0 f64:8@8} <- {i64:8@0 f64:8@8}"
    );
    assert_eq!(
        abi_of(with_int, LINUX_ARM64),
        "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}"
    );
    // A `double` beside a vector of the same size is not a homogeneous aggregate.
    let mixed = "typedef float v __attribute__((vector_size(8))); struct P { double d; v a; }; struct P f(struct P p);";
    assert_eq!(
        abi_of(mixed, LINUX_ARM64),
        "{i64:8@0 i64:8@8} <- {i64:8@0 i64:8@8}"
    );
    assert_eq!(
        abi_of(mixed, LINUX_X64),
        "{f64:8@0 f64:8@8} <- {f64:8@0 f64:8@8}"
    );
    let four = "typedef unsigned short v __attribute__((vector_size(8))); struct Q { v val[4]; }; struct Q f(struct Q q);";
    assert_eq!(
        abi_of(four, LINUX_ARM64),
        "{f64:8@0 f64:8@8 f64:8@16 f64:8@24} <- {f64:8@0 f64:8@8 f64:8@16 f64:8@24}"
    );
    assert_eq!(abi_of(four, LINUX_X64), "sret <- stack(32,8)");
    crate::tests::checked_for(
        "typedef double v __attribute__((vector_size(8))); v f(v a) { return a + a; }",
        LINUX_ARM64,
    );
}

fn dump(src: &str, target: Target) -> String {
    match compile(src.as_bytes(), "t.c", target) {
        Ok(bir) => disassemble(&bir).unwrap(),
        Err(d) => panic!("{}", d[0]),
    }
}

#[test]
fn structs_through_variadics_and_callbacks() {
    // A memory-class variadic argument needs a call-site signature that lists it.
    let text = dump(
        "struct big { long v[4]; }; int take(int n, ...); int f(void) { struct big b = { { 1 } }; return take(1, b, 2); }",
        LINUX_X64,
    );
    assert!(
        has(&text, "(i32, byval(32, align 8), i32, ...) -> i32") && has(&text, "CallIndirect"),
        "{text}"
    );
    // va_arg of aggregates on the pointer-style va_lists.
    let src = "#include <stdarg.h>\nstruct pair { double a, b; }; struct big { long long v[4]; }; double f(int n, ...) { va_list ap; va_start(ap, n); struct pair p = va_arg(ap, struct pair); struct big b = va_arg(ap, struct big); va_end(ap); return p.a + (double)b.v[3]; }";
    for target in [MAC_ARM64, WINDOWS_X64, LINUX_ARM64] {
        let text = dump(src, target);
        assert!(has(&text, "VaStart"), "{text}");
    }
    let apple = dump(
        "struct pair { double a, b; }; int take(int n, ...); int f(void) { struct pair p = { 1, 2 }; return take(1, p); }",
        MAC_ARM64,
    );
    assert!(
        has(&apple, "CallExtern 0 <take> (v") && has(&apple, "Load i64"),
        "{apple}"
    );
}
