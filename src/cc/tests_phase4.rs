//! Tests for passing and returning structs and unions by value.

use std::fmt::Write as _;

use crate::abi::{ArgPass, Piece, RetPass, lower_call};
use crate::bir::Exhausts;
use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, checked, has};
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
        ("", "void <- none", "void <- none", "void <- none"),
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
    let one_double = crate::tests::error_for(
        "typedef double v __attribute__((vector_size(8))); v f(v a) { return a; }",
        LINUX_X64,
    );
    assert!(has(&one_double, "GCC and Clang disagree"), "{one_double}");
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

/// Every shape from the classification table, passed and returned by value on the
/// executable x86-64 model: `T id(T x)` must return what it got, and must not let a
/// change to its parameter reach the caller's object.
#[test]
fn every_shape_round_trips_by_value() {
    let shapes: &[(&str, &str)] = &[
        ("int a;", "{ 7 }"),
        ("char a;", "{ 'x' }"),
        ("short a; char b;", "{ -3, 'y' }"),
        ("int a, b;", "{ 1, -2 }"),
        ("long a, b;", "{ 1L << 40, -5 }"),
        ("long a, b, c;", "{ 11, 22, 33 }"),
        ("double a;", "{ 2.5 }"),
        ("float a;", "{ 1.5f }"),
        ("float a, b;", "{ 1.5f, -2.25f }"),
        ("float a, b, c;", "{ 1.5f, -2.25f, 8.0f }"),
        ("float a, b, c, d;", "{ 1.5f, -2.25f, 8.0f, 0.125f }"),
        ("double a, b;", "{ 1.5, -2.25 }"),
        ("double a, b, c;", "{ 1.5, -2.25, 1e100 }"),
        ("int a; double b;", "{ -9, 0.75 }"),
        ("double a; int b;", "{ 0.75, -9 }"),
        ("float a; int b;", "{ 0.5f, 123456 }"),
        ("char a[3];", "{ { 1, 2, 3 } }"),
        ("char a[5];", "{ { 1, 2, 3, 4, 5 } }"),
        ("char a[7];", "{ \"sixsix\" }"),
        ("char a[16];", "{ \"fifteen chars..\" }"),
        ("char a[17];", "{ \"sixteen chars...\" }"),
        ("int a, b, c;", "{ 1, 2, 3 }"),
        ("struct { int x, y; } in; double d;", "{ { 4, 5 }, 6.5 }"),
        ("double a[2];", "{ { 3.5, 4.5 } }"),
        (
            "unsigned a : 3; unsigned b : 20; short c;",
            "{ 5, 99999, -7 }",
        ),
        (
            "char bytes[64];",
            "{ \"sixty-four bytes of struct passed through memory, by value....\" }",
        ),
    ];
    let source_for = |skip_bit_fields: bool| -> String {
        let mut src = String::from(
            "int memcmp(const void *, const void *, unsigned long);\n\
             static void scribble(void *p, unsigned long n) { unsigned char *b = p; while (n--) *b++ ^= 0x5a; }\n",
        );
        for (i, (members, init)) in shapes.iter().enumerate() {
            if skip_bit_fields && has(members, " : ") {
                continue;
            }
            let _ = write!(
                src,
                "struct T{i} {{ {members} }};\n\
                 static struct T{i} id{i}(struct T{i} x) {{ struct T{i} copy = x; scribble(&x, sizeof x); return copy; }}\n\
                 static struct T{i} (*const indirect{i})(struct T{i}) = id{i};\n\
                 int check{i}(void) {{\n\
                     struct T{i} original = {init}, before = original;\n\
                     struct T{i} back = id{i}(original);\n\
                     struct T{i} again = indirect{i}(id{i}(back));\n\
                     return memcmp(&back, &before, sizeof back) == 0 && memcmp(&original, &before, sizeof before) == 0 && memcmp(&again, &before, sizeof again) == 0;\n\
                 }}\n",
            );
        }
        src
    };
    let src = source_for(false);
    checked(&src);
    // The same source compiles for the other ABIs.
    for target in [LINUX_ARM64, MAC_ARM64] {
        let text = dump(&src, target);
        assert!(has(&text, "func"), "{text}");
    }
    // Win64 too, minus the bit-field shape (no MSVC bit-field layout yet).
    assert!(has(&dump(&source_for(true), WINDOWS_X64), "func"));
}

#[test]
fn register_exhaustion_and_mixed_arguments() {
    checked(
        "struct P { long a, b; }; struct D { double a, b; }; struct M { int i; double d; }; struct Big { long v[3]; };
         static long after_seven(int a, int b, int c, int d, int e, int f, int g, struct P p, int h) { return a + b + c + d + e + f + g + p.a * 1000 + p.b * 100000 + h * 10000000; }
         long ints_then_struct(void) { struct P p = { 3, 4 }; return after_seven(1, 1, 1, 1, 1, 1, 1, p, 5); }
         static long one_register_left(int a, int b, int c, int d, int e, struct P p, int h) { return a + b + c + d + e + p.a * 1000 + p.b * 100000 + h * 10000000; }
         long split_is_not_allowed(void) { struct P p = { 3, 4 }; return one_register_left(1, 1, 1, 1, 1, p, 5); }
         static double after_nine(double a, double b, double c, double d, double e, double f, double g, double h, double i, struct D p, double z) { return a + b + c + d + e + f + g + h + i + p.a * 100 + p.b * 1000 + z * 10000; }
         double doubles_then_struct(void) { struct D p = { 1.5, 2.5 }; return after_nine(1, 1, 1, 1, 1, 1, 1, 1, 1, p, 3.0); }
         static double seven_then_pair(double a, double b, double c, double d, double e, double f, double g, struct D p, double z) { return a + b + c + d + e + f + g + p.a * 100 + p.b * 1000 + z * 10000; }
         double one_float_register_left(void) { struct D p = { 1.5, 2.5 }; return seven_then_pair(1, 1, 1, 1, 1, 1, 1, p, 3.0); }
         static double mixed(struct M m, int a, struct D d, struct Big big, struct P p, double x, struct M m2) { return m.i + m.d + a + d.a + d.b + (double)(big.v[0] + big.v[1] + big.v[2]) + (double)(p.a + p.b) + x + m2.i * m2.d; }
         double all_kinds(void) { struct M m = { 1, 0.5 }, m2 = { 4, 0.25 }; struct D d = { 2.0, 3.0 }; struct Big big = { { 10, 20, 30 } }; struct P p = { 100, 200 }; return mixed(m, 7, d, big, p, 0.125, m2); }
         struct Big make_big(long a, long b, long c) { struct Big r = { { a, b, c } }; return r; }
         long big_result(void) { struct Big r = make_big(7, 8, 9); return r.v[0] * 100 + r.v[1] * 10 + r.v[2] + make_big(1, 2, 3).v[1] * 1000; }
         static struct Big shifted(struct Big in, long by) { for (int i = 0; i < 3; i++) in.v[i] += by; return in; }
         long chained(void) { struct Big r = make_big(1, 2, 3); return shifted(shifted(r, 10), 100).v[2] + r.v[2]; }",
    );
    // Aggregate signatures keep their exported flag but JS cannot call them.
    let text = dump(
        "struct P { long a, b; }; struct P make(long a) { struct P p = { a, a }; return p; } long use(void) { return make(2).b; }",
        LINUX_X64,
    );
    assert!(
        has(&text, " make (exported): sig")
            && has(&text, "-> (i64, i64)")
            && !has(&text, "export make"),
        "{text}"
    );
    assert!(has(&text, "export use"), "{text}");
}

#[test]
fn structs_through_variadics_and_callbacks() {
    checked(
        "#include <stdarg.h>
         void qsort(void *base, unsigned long n, unsigned long size, int (*cmp)(const void *, const void *));
         struct pair { double a, b; };
         struct ipair { int a; long b; };
         struct big { long v[4]; };
         struct small { char c[3]; };
         static double sum_pairs(int count, ...) { va_list ap; va_start(ap, count); double total = 0; for (int i = 0; i < count; i++) { struct pair p = va_arg(ap, struct pair); total += p.a + p.b; } va_end(ap); return total; }
         double pairs(void) {
             struct pair p1 = { 1, 2 }, p2 = { 3, 4 }, p3 = { 5, 6 }, p4 = { 7, 8 }, p5 = { 9, 10 }, p6 = { 11, 12 };
             return sum_pairs(6, p1, p2, p3, p4, p5, p6);
         }
         static double mixed(int count, ...) {
             va_list ap; va_start(ap, count); double total = 0;
             for (int i = 0; i < count; i++) {
                 struct ipair ip = va_arg(ap, struct ipair); total += ip.a + (double)ip.b;
                 total += va_arg(ap, double);
                 struct big b = va_arg(ap, struct big); total += (double)(b.v[0] + b.v[3]);
                 struct small s = va_arg(ap, struct small); total += s.c[2];
                 total += va_arg(ap, int);
             }
             va_end(ap);
             return total;
         }
         double everything(void) {
             struct ipair ip = { 1, 2 }; struct big b = { { 10, 0, 0, 20 } }; struct small s = { { 0, 0, 3 } };
             return mixed(4, ip, 0.5, b, s, 100, ip, 0.5, b, s, 100, ip, 0.5, b, s, 100, ip, 0.5, b, s, 100);
         }
         static double odd_registers(int n, double lead, ...) { va_list ap; va_start(ap, lead); double total = lead; while (n--) { struct pair p = va_arg(ap, struct pair); total += p.a * 10 + p.b; } va_end(ap); return total; }
         double split_case(void) { struct pair p = { 1, 2 }; return odd_registers(4, 0.5, p, p, p, p); }
         struct item { int key; char name[12]; };
         static int by_key(const void *a, const void *b) { struct item x = *(const struct item *)a, y = *(const struct item *)b; return x.key - y.key; }
         static struct item smallest(struct item *items, int n) { qsort(items, (unsigned long)n, sizeof *items, by_key); return items[0]; }
         int sorted(void) { struct item items[4] = { { 30, \"c\" }, { 10, \"a\" }, { 40, \"d\" }, { 20, \"b\" } }; struct item first = smallest(items, 4); return first.key + first.name[0] + items[3].key * 1000; }",
    );
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
