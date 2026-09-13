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

pub(crate) fn has(haystack: &str, needle: &str) -> bool {
    let (h, n) = (haystack.as_bytes(), needle.as_bytes());
    (0..=h.len().saturating_sub(n.len())).any(|i| h[i..].starts_with(n))
}

// ───────────────────────────── basics ─────────────────────────────

// ───────────────────────────── structs, pointers, arrays ─────────────────────────────

// ───────────────────────────── function pointers, switch, goto ─────────────────────────────

// ───────────────────────────── integers and conversions ─────────────────────────────

#[test]
fn narrow_integer_wraparound_and_extension() {
    // Plain char is unsigned on aarch64-linux.
    checked_for(
        "int char_extend(void) { char c = (char)200; return c; } int lit(void) { return '\\xff'; }",
        LINUX_ARM64,
    );
}

// ───────────────────────────── operators with control flow ─────────────────────────────

// ───────────────────────────── initializers and globals ─────────────────────────────

// ───────────────────────────── externs and exports ─────────────────────────────

#[test]
fn export_table_for_other_targets() {
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
    // (What these are for the machine the tests run on is fixtures/exports/ffi-types-of-the-exports.)
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
