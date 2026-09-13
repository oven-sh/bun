//! What can be checked without running the compiled code: diagnostics, the text and the bytes
//! of the modules the compiler writes, and that sources compile for every target. Everything
//! that runs compiled code is a Bun test under `test/js/bun/ffi/bir/`.

use crate::{Arch, Os, Target, compile, disassemble, validate};

pub(crate) const LINUX_X64: Target = Target {
    arch: Arch::X86_64,
    os: Os::Linux,
};
pub(crate) const LINUX_ARM64: Target = Target {
    arch: Arch::Aarch64,
    os: Os::Linux,
};
pub(crate) const WINDOWS_X64: Target = Target {
    arch: Arch::X86_64,
    os: Os::Windows,
};

/// Compiles `src` for `target` and checks that the module validates and can be listed.
pub(crate) fn checked_for(src: &str, target: Target) -> Vec<u8> {
    let bir = match compile(src.as_bytes(), "test.c", target) {
        Ok(bir) => bir,
        Err(diagnostics) => panic!("compile failed: {}", diagnostics[0]),
    };
    validate(&bir).expect("validate");
    disassemble(&bir).expect("disassemble");
    bir
}

pub(crate) fn checked(src: &str) -> Vec<u8> {
    checked_for(src, LINUX_X64)
}

/// Compiles `src` expecting failure; returns "line:col: message".
pub(crate) fn error_for(src: &str, target: Target) -> String {
    match compile(src.as_bytes(), "test.c", target) {
        Ok(_) => panic!("expected a compile error for:\n{src}"),
        Err(d) => {
            assert!(d[0].line > 0, "diagnostic without a location: {}", d[0]);
            format!("{}:{}: {}", d[0].line, d[0].col, d[0].message)
        }
    }
}

pub(crate) fn error(src: &str) -> String {
    error_for(src, LINUX_X64)
}

pub(crate) fn has(haystack: &str, needle: &str) -> bool {
    let (h, n) = (haystack.as_bytes(), needle.as_bytes());
    (0..=h.len().saturating_sub(n.len())).any(|i| h[i..].starts_with(n))
}

pub(crate) fn assert_error(src: &str, needle: &str) {
    let e = error(src);
    assert!(has(&e, needle), "error {e:?} does not mention {needle:?}");
}

// ───────────────────────────── basics ─────────────────────────────

// ───────────────────────────── structs, pointers, arrays ─────────────────────────────

// ───────────────────────────── function pointers, switch, goto ─────────────────────────────

// ───────────────────────────── integers and conversions ─────────────────────────────

#[test]
fn narrow_integer_wraparound_and_extension() {
    checked(
        "int uchar_wrap(void) { unsigned char c = 255; c++; return c; }
         int uchar_dec(void) { unsigned char c = 0; c--; return c; }
         int schar_wrap(void) { signed char c = 127; c++; return c; }
         int short_wrap(void) { short s = 32767; s += 1; return s; }
         int ushort_wrap(void) { unsigned short s = 65535; ++s; return s; }
         int schar_extend(void) { signed char c = (signed char)0x80; int i = c; return i; }
         int char_extend(void) { char c = (char)200; return c; }
         int promote_add(void) { return (unsigned char)200 + (unsigned char)100; }
         int promote_neg(void) { unsigned char c = 1; return -c; }
         int promote_not(void) { unsigned char c = 0; return ~c; }
         int narrow_assign_value(void) { unsigned char c; int v = (c = 0x1ff); return v; }
         int narrow_compound(void) { unsigned char c = 250; c += 10; c *= 2; return c; }
         int narrow_shift(void) { unsigned char c = 0x81; c <<= 1; return c; }
         int narrow_param(unsigned char a, signed char b, short c) { return a + b + c; }
         short ret_short(int v) { return v; }
         unsigned char ret_uchar(int v) { return v; }
         int store_load(void) { struct { signed char a; unsigned char b; short c; unsigned short d; } s; s.a = -1; s.b = -1; s.c = -2; s.d = -2; return s.a + s.b + s.c + s.d; }
         int trunc64(long long v) { return (int)v + (short)v + (unsigned char)v; }
         long long widen(int s, unsigned u) { return (long long)s + u; }
         int post_value(void) { unsigned char c = 255; int old = c++; return old * 1000 + c; }",
    );
    // Plain char is unsigned on aarch64-linux.
    checked_for(
        "int char_extend(void) { char c = (char)200; return c; } int lit(void) { return '\\xff'; }",
        LINUX_ARM64,
    );
}

#[test]
fn sixty_four_bit_math() {
    checked(
        "long long mul(long long a, long long b) { return a * b; }
         unsigned long long umax(void) { return 0xffffffffffffffffULL; }
         long long big(void) { return 1LL << 62; }
         long long mix(int a, long long b) { return a + b * 2; }
         unsigned long fnv_offset(void) { return 14695981039346656037UL; }
         int high(unsigned long long v) { return (int)(v >> 32); }
         long long neg(long long v) { return -v; }
         int sizes(void) { return sizeof(long) * 100 + sizeof(long long) * 10 + sizeof(void *) + sizeof(1L) * 1000 + sizeof(1u) * 10000; }
         long long literal_types(void) { return sizeof(2147483647) + sizeof(2147483648) * 10 + sizeof(0x7fffffff) * 100 + sizeof(0xffffffff) * 1000 + sizeof(0x100000000) * 10000; }
         int unsigned_literal(void) { return 0xffffffff > 0; }
         long long udiv64(unsigned long long a, unsigned long long b) { return a / b; }",
    );
    // LLP64: long is 4 bytes, and the export signature says int32.
    checked_for(
        "int sizes(void) { return sizeof(long) * 10 + sizeof(long long); } long id(long v) { return v + 1; } long long d(char *a, char *b) { return a - b; }",
        WINDOWS_X64,
    );
}

// ───────────────────────────── operators with control flow ─────────────────────────────

// ───────────────────────────── initializers and globals ─────────────────────────────

// ───────────────────────────── externs and exports ─────────────────────────────

#[test]
fn export_table_uses_ffi_types() {
    let src = "typedef enum { RED, GREEN } Color;
         char f_char(char a) { return a; }
         signed char f_i8(signed char a) { return a; }
         unsigned char f_u8(unsigned char a) { return a; }
         short f_i16(short a) { return a; }
         unsigned short f_u16(unsigned short a) { return a; }
         int f_i32(int a) { return a; }
         unsigned f_u32(unsigned a) { return a; }
         long f_long(long a, unsigned long b) { return a + b; }
         long long f_i64(long long a, unsigned long long b) { return a + b; }
         double f_double(double a, float b) { return a + b; }
         float f_float(float a) { return a; }
         _Bool f_bool(_Bool a) { return a; }
         void *f_ptr(const char *a, int **b, int (*cb)(int)) { return 0; }
         void f_void(void) {}
         Color f_enum(Color c) { return c; }
         static int hidden(int a) { return a; }
         int uses_hidden(int a) { return hidden(a); }";
    let text = disassemble(&compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    for line in [
        "export f_char = func 0: (char) -> char",
        "export f_i8 = func 1: (int8) -> int8",
        "export f_u8 = func 2: (uint8) -> uint8",
        "export f_i16 = func 3: (int16) -> int16",
        "export f_u16 = func 4: (uint16) -> uint16",
        "export f_i32 = func 5: (int32) -> int32",
        "export f_u32 = func 6: (uint32) -> uint32",
        "export f_long = func 7: (int64, uint64) -> int64",
        "export f_i64 = func 8: (int64, uint64) -> int64",
        "export f_double = func 9: (double, float) -> double",
        "export f_float = func 10: (float) -> float",
        "export f_bool = func 11: (bool) -> bool",
        "export f_ptr = func 12: (pointer, pointer, pointer) -> pointer",
        "export f_void = func 13: () -> void",
        // An enumeration without negative values is compatible with unsigned int.
        "export f_enum = func 14: (uint32) -> uint32",
        "export uses_hidden = func 16: (int32) -> int32",
    ] {
        assert!(has(&text, line), "missing {line:?} in:\n{text}");
    }
    assert!(!has(&text, "export hidden"));
    let windows = disassemble(&compile(src.as_bytes(), "t.c", WINDOWS_X64).unwrap()).unwrap();
    assert!(
        has(&windows, "export f_long = func 7: (int32, uint32) -> int32"),
        "{windows}"
    );
    assert!(windows.starts_with("bir module x86_64-windows"));
    let arm = disassemble(
        &compile(
            src.as_bytes(),
            "t.c",
            Target {
                arch: Arch::Aarch64,
                os: Os::MacOs,
            },
        )
        .unwrap(),
    )
    .unwrap();
    assert!(arm.starts_with("bir module arm64-darwin"));
}

#[test]
fn comments_splices_and_tokens() {
    checked(
        "// line comment with a fake */ terminator\n/* block\n comment */ int a(void) { return 1 /* inline */ + 2; } // trailing\nint b(void) { return 10 \\\n + 5; }\nint c(void) { return 0x1F + 017 + 0b101 + 'A' + 10u + 10l + 10ull; }\nint d(int x) { return x+++1; }\nint e(int x, int *p) { return x/ *p; }",
    );
    let tokens = crate::dump_tokens(b"#define X 1\n  a+ b", "t.c").unwrap();
    assert!(
        has(&tokens, "1:1: Punct(Hash) # [start-of-line]"),
        "{tokens}"
    );
    assert!(has(&tokens, "1:2: Ident define\n"), "{tokens}");
    assert!(
        has(&tokens, "2:3: Ident a [start-of-line] [leading-space]"),
        "{tokens}"
    );
    assert!(has(&tokens, "2:4: Punct(Plus) +\n"), "{tokens}");
    assert!(has(&tokens, "2:6: Ident b [leading-space]"), "{tokens}");
}

// ───────────────────────────── diagnostics ─────────────────────────────

#[test]
fn unsupported_constructs_are_diagnosed() {
    // Where `long double` is IEEE binary128 it can be declared and nothing more.
    for (src, needle) in [
        (
            "long double f(long double x) { return x; }",
            "'long double' is not supported yet",
        ),
        (
            "long double g; double f(void) { return g + 1; }",
            "computing with values of type 'long double'",
        ),
        (
            "double f(void) { return 1.0L; }",
            "'long double' is not supported yet",
        ),
        (
            "long double ld(void); void f(void) { ld(); }",
            "'long double' is not supported yet",
        ),
    ] {
        let message = error_for(src, LINUX_ARM64);
        assert!(has(&message, needle), "{src}: {message}");
    }
    assert_error(
        "void f(int x) { __asm__(\"pushq %q0\" : \"+r\"(x)); }",
        "inline assembly: 'pushq' would disturb the stack frame",
    );
    assert_error(
        "int f(void) { return g(1); }",
        "implicit function declarations are not allowed",
    );
    assert_error(
        "static int f(void); int g(void) { return f(); }",
        "used but never defined",
    );
    assert!(has(
        &error_for("struct S { int a : 3; } s;", WINDOWS_X64),
        "bit-fields are not supported for Windows"
    ));
}

#[test]
fn syntax_and_type_errors_are_diagnosed() {
    assert_error("int f(void) { return 1 }", "1:24: expected ';'");
    assert_error(
        "int f(void) { return x; }",
        "use of undeclared identifier 'x'",
    );
    assert_error(
        "int f(void) {\n  int a;\n  int a;\n}",
        "3:7: redefinition of 'a'",
    );
    assert_error(
        "int f(void) { int *p = 5; return 0; }",
        "incompatible types",
    );
    assert_error(
        "int f(int *p) { int x = p; return x; }",
        "incompatible types",
    );
    assert_error(
        "struct S { int a; }; int f(struct S s1) { return s1 + 1; }",
        "invalid operands",
    );
    assert_error(
        "struct S { int a; }; int f(struct S *s) { return *s + 1; }",
        "invalid operands",
    );
    assert_error("int f(void) { 3 = 4; return 0; }", "not assignable");
    assert_error(
        "int f(void) { int a[2]; int b[2]; a = b; return 0; }",
        "array type is not assignable",
    );
    assert_error("int f(int x) { return x.y; }", "not a struct or union");
    assert_error(
        "struct S { int a; }; int f(struct S *s) { return s->b; }",
        "no member named 'b'",
    );
    assert_error("int f(int x) { return *x; }", "requires a pointer");
    assert_error("int f(int x) { return x(); }", "not a function");
    assert_error(
        "int g(int); int f(void) { return g(1, 2); }",
        "wrong number of arguments",
    );
    assert_error("int f(void) { break; }", "'break' statement not in");
    assert_error("int f(void) { continue; }", "'continue' statement not in");
    assert_error("int f(int x) { case 1: return x; }", "not within a switch");
    assert_error(
        "int f(int x) { switch (x) { case 1: case 1: return 0; } return 1; }",
        "duplicate case",
    );
    assert_error(
        "int f(void) { goto nowhere; }",
        "undeclared label 'nowhere'",
    );
    assert_error("int f(void) { l: l: return 0; }", "redefinition of label");
    assert_error("void f(void) { return 1; }", "should not return a value");
    assert_error("int f(void) { struct U u; return 0; }", "incomplete type");
    assert_error("int a[-1];", "negative");
    assert_error("int g = f;", "undeclared");
    assert_error("int x = 1; int x = 2;", "redefinition of 'x'");
    assert_error("int f(void); double f(void);", "conflicting types");
    assert_error(
        "int f(int a) { return 1; } int f(int a) { return 2; }",
        "redefinition of 'f'",
    );
    assert_error("int y; int g = y;", "not a compile-time constant");
    assert_error("int a[2] = { 1, 2, 3 };", "excess elements");
    assert_error("char s[2] = \"abc\";", "too long");
    assert_error(
        "struct P { int x; }; struct P p = { .q = 1 };",
        "no member named 'q'",
    );
    assert_error("int f(void) { int x; return &x + &x; }", "invalid operands");
    assert_error("int f(double d) { return d % 2; }", "invalid operands");
    assert_error("int f(double d) { return ~d; }", "invalid operand");
    assert_error("unsigned signed x;", "both 'signed' and 'unsigned'");
    assert_error("int float x;", "invalid combination");
    assert_error("x;", "expected a type");
    assert_error("int f(void) { return 1 +; }", "expected an expression");
    assert_error("int f(void) { return (1; }", "expected ')'");
    assert_error("int f(void) { /* never closed", "unterminated /* comment");
    assert_error("char *s = \"abc;\nint x;", "unterminated string literal");
    assert_error("int x = 'ab';", "multi-character");
    assert_error("int x = 12abc;", "invalid integer constant");
    assert_error("int x = 99999999999999999999;", "too large");
    assert_error("int x = 1 @ 2;", "unexpected character '@'");
    assert_error("int a[1 / 0];", "division by zero");
    assert_error("enum { Z = 5 % 0 };", "division by zero");
    assert_error("int s[1 << 40 >> 100];", "shift count");
    assert_error(
        "_Static_assert(sizeof(int) == 8, \"int is 4\");",
        "static assertion failed: int is 4",
    );
    assert_error("int f(void) {", "expected '}'");
    assert_error("struct S { struct S inner; };", "incomplete type");
    assert_error("void v; ", "has type void");
    assert_error(
        "int f(void) { int big[1 << 30][1 << 30]; return 0; }",
        "too large",
    );
    assert_error("int a[] = { [0x7fffffff] = 1 };", "too large");
}

#[test]
fn pathological_nesting_is_an_error_not_a_crash() {
    let deep_parens = format!(
        "int f(void) {{ return {}1{}; }}",
        "(".repeat(5000),
        ")".repeat(5000)
    );
    assert!(has(&error(&deep_parens), "nesting is too deep"));
    let deep_blocks = format!(
        "void f(void) {{ {} {} }}",
        "{".repeat(5000),
        "}".repeat(5000)
    );
    assert!(has(&error(&deep_blocks), "nesting is too deep"));
    let deep_unary = format!("int f(int x) {{ return {}x; }}", "-".repeat(5000));
    assert!(has(&error(&deep_unary), "nesting is too deep"));
    let deep_decl = format!("int {}x{};", "(*".repeat(5000), ")".repeat(5000));
    assert!(has(&error(&deep_decl), "nesting is too deep"));
    let deep_init = format!("int x = {}1{};", "{".repeat(5000), "}".repeat(5000));
    assert!(has(&error(&deep_init), "nesting is too deep"));
    let long_chain = format!("int f(int x) {{ return x{}; }}", " + x".repeat(5000));
    assert!(has(&error(&long_chain), "nested too deeply"));
    let deep_else = format!(
        "int f(int x) {{ {} return 0; }}",
        "if (x) return 1; else ".repeat(5000)
    );
    assert!(has(&error(&deep_else), "nesting is too deep"));
    // Just under the limits still compiles and runs.
    let ok_chain = format!("int f(int x) {{ return x{}; }}", " + x".repeat(990));
    checked(&ok_chain);
    let ok_parens = format!(
        "int f(void) {{ return {}7{}; }}",
        "(".repeat(240),
        ")".repeat(240)
    );
    checked(&ok_parens);
}

#[test]
fn garbage_input_never_panics() {
    let seeds: [&[u8]; 8] = [
        b"int f(int x) { switch (x) { case 1: { int a[3] = {1,2,3}; return a[x] ? x : -x; } default: break; } return 0; }",
        b"struct S { int a; char *b; union { int c; float d; }; } s = { 1, \"x\", { 2 } };",
        b"typedef int (*fn)(int, ...); static fn table[2]; int g(int a) { return table[a & 1] ? 1 : 0; }",
        b"double d = 1e10; float f = 0x1.8p3f; char c = '\\n'; long long big = 0x7fffffffffffffffLL;",
        b"int main(void) { for (int i = 0; i < 10; i++) { if (i % 2) continue; else break; } do ; while (0); return 0; }",
        b"\xff\xfe\x00int\x00 x;",
        b"int a = (((((((;",
        b"\"unterminated",
    ];
    // Deterministic mutations: truncate everywhere, and overwrite each byte with a few values.
    for seed in seeds {
        for end in 0..=seed.len() {
            let _ = compile(&seed[..end], "fuzz.c", LINUX_X64);
        }
        for i in 0..seed.len() {
            for replacement in [b'(', b'{', b';', b'*', b'0', b'"', 0u8, 0x80] {
                let mut mutated = seed.to_vec();
                mutated[i] = replacement;
                if let Ok(bir) = compile(&mutated, "fuzz.c", LINUX_X64) {
                    validate(&bir).expect("compiled output must validate");
                }
            }
        }
    }
}

#[test]
fn decoder_rejects_corrupt_modules() {
    let bir = compile(b"int f(int x) { return x ? x + 1 : 2; }", "t.c", LINUX_X64).unwrap();
    assert!(validate(&bir).is_ok());
    for end in 0..bir.len() {
        assert!(
            validate(&bir[..end]).is_err(),
            "truncation at {end} accepted"
        );
    }
    for i in 0..bir.len() {
        let mut bad = bir.clone();
        bad[i] ^= 0xff;
        // Must not panic; most flips are rejected, a few (names, constants) are still valid.
        let _ = validate(&bad);
        let _ = disassemble(&bad);
    }
}

#[test]
fn select_and_folding_show_up_in_the_output() {
    let text = disassemble(&compile(b"int pick(int c, int a, int b) { return c ? a : b; } int k(void) { return (3 + 4) * 2 - sizeof(int); }", "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(has(&text, "Select"), "{text}");
    assert!(has(&text, "ConstI32 10"), "{text}");
    assert!(!has(&text, "Mul"), "{text}");
}

#[test]
fn encoding_matches_the_spec_byte_for_byte() {
    let bir = compile(b"void f(void) {}", "t.c", LINUX_ARM64).unwrap();
    #[rustfmt::skip]
    let expected: &[u8] = &[
        b'B', b'I', b'R', b'6', 1, 0, 8, 0, // magic, arch arm64, os linux, pointerBytes, reserved
        1, 0, 0, 0,                         // nsigs; sig 0: no results, flags, no parameters
        0,                                  // nexterns
        0, 1, 0, 0,                         // data: size, align, ninit, nrelocs
        0, 1, 0, 0,                         // tls: size, align, ninit, nrelocs
        1, 1, b'f', 0, 1,                   // nfuncs; decl: name, sig, flags (exported)
        0, 0, 1, 1, 0x64,                   // body: nlocals, nslots, nblocks, ninsts, RetVoid
        1, 1, b'f', 0, 13, 0,               // nexports; name, func, ffiRet void, nargs
        0,                                  // nlibraries
        0, 0,                               // nconstructors, ndestructors
    ];
    assert_eq!(bir, expected);

    let bir = compile(
        b"static int g = -2; int f(int x) { return x + g; }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    #[rustfmt::skip]
    let expected: &[u8] = &[
        b'B', b'I', b'R', b'6', 0, 0, 8, 0,
        1, 1, 1, 0, 1, 0, 1,                // sig 0: one i32 result, not variadic, one Value i32 parameter
        0,
        4, 4, 4, 0xfe, 0xff, 0xff, 0xff, 0, // data: size 4, align 4, 4 init bytes, no relocs
        0, 1, 0, 0,                         // no thread-local objects
        1, 1, b'f', 0, 1,
        1, 1, 0,                            // one i32 local, no slots
        1, 6,                               // one block, six instructions
        0x47, 0, 0,                         // LocalSet 0, v0
        0x46, 0,                            // v1 = LocalGet 0
        0x43, 0,                            // v2 = DataAddr 0
        0x40, 4, 2, 0,                      // v3 = Load I32 [v2 + 0]
        0x10, 1, 3,                         // v4 = Add v1, v3
        0x63, 4,                            // Ret v4
        1, 1, b'f', 0, 5, 1, 5,             // export f: int32 (int32)
        0,                                  // no libraries
        0, 0,                               // no constructors, no destructors
    ];
    assert_eq!(bir, expected);
}

#[test]
fn extern_data_symbols() {
    let src = "typedef struct FILE FILE;
         extern FILE *stdout, *stderr;
         extern char **environ;
         extern int counter_elsewhere;
         static FILE **where = &stdout;
         static int *pcounter = &counter_elsewhere + 1;
         int is_stdout(void) { return *where == stdout && stdout != stderr; }
         int bump(void) { counter_elsewhere += 5; return ++counter_elsewhere + pcounter[-1]; }
         int no_env(void) { return environ == 0; }";
    checked(src);
    let text = disassemble(&compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(has(&text, "extern 0: stdout data"), "{text}");
    assert!(has(&text, "ExternAddr"), "{text}");
    assert!(has(&text, "extern 2 addend 4"), "{text}");
    // Golden bytes for the extern table entry: name, kind, sig.
    let bir = compile(
        b"extern int e; int puts(const char *); int f(void) { return e + puts(0); }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    let table: &[u8] = &[2, 1, b'e', 1, 0, 4, b'p', b'u', b't', b's', 0, 1];
    assert!(
        (0..bir.len()).any(|i| bir[i..].starts_with(table)),
        "{bir:?}"
    );
}
