//! Tests for the preprocessor, the builtin headers and the language features that real
//! headers need.

use std::rc::Rc;

use crate::lexer::Lexer;
use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, checked_for, has};
use crate::token::{PpKind, TokenSource};
use crate::{CompileOptions, disassemble, preprocess};

/// Spellings of the preprocessing tokens in `text`.
pub(crate) fn tokens_of(text: &str) -> Vec<String> {
    let mut lexer = Lexer::new(Rc::from(text.as_bytes()), 0);
    let mut out = Vec::new();
    loop {
        let t = lexer.next_token().expect("lex");
        if t.kind == PpKind::Eof {
            return out;
        }
        out.push(crate::token::display_bytes(crate::pp::spelling(&t)));
    }
}

fn pp(src: &str) -> Vec<String> {
    let options = CompileOptions::new(LINUX_X64);
    match preprocess(src.as_bytes(), "test.c", &options) {
        Ok(text) => tokens_of(&text),
        Err(d) => panic!("preprocess failed: {}", d[0]),
    }
}

// ───────────────────────────── preprocessor ─────────────────────────────

/// The expected output was produced by `cc -E -P` (GCC) on the same file.
#[test]
fn macro_torture_matches_gcc() {
    let actual = pp(include_str!("testdata/pp_torture.c"));
    let expected = tokens_of(include_str!("testdata/pp_torture.expected"));
    for (i, (a, e)) in actual.iter().zip(&expected).enumerate() {
        assert_eq!(
            a,
            e,
            "token {i} differs: ... {}",
            actual[i.saturating_sub(8)..(i + 4).min(actual.len())].join(" ")
        );
    }
    assert_eq!(actual.len(), expected.len());
}

#[test]
fn predefined_macros_per_target() {
    let check = |target, src: &str| {
        let text = preprocess(src.as_bytes(), "t.c", &CompileOptions::new(target)).unwrap();
        tokens_of(&text).join(" ")
    };
    let src = "__SIZEOF_LONG__ __SIZEOF_POINTER__ __SIZEOF_LONG_DOUBLE__ __SIZEOF_WCHAR_T__ __INT64_TYPE__ __SIZE_TYPE__ __BYTE_ORDER__ __CHAR_BIT__";
    assert_eq!(check(LINUX_X64, src), "8 8 16 4 long unsigned long 1234 8");
    assert_eq!(
        check(WINDOWS_X64, src),
        "4 8 8 2 long long unsigned long long 1234 8"
    );
    let ids = "__x86_64__ __aarch64__ __linux__ _WIN32 __APPLE__ __LP64__ __CHAR_UNSIGNED__ __GNUC__ __clang__ __BUN_CC__";
    assert_eq!(
        check(LINUX_X64, ids),
        "1 __aarch64__ 1 _WIN32 __APPLE__ 1 __CHAR_UNSIGNED__ __GNUC__ __clang__ 1"
    );
    assert_eq!(
        check(LINUX_ARM64, ids),
        "__x86_64__ 1 1 _WIN32 __APPLE__ 1 1 __GNUC__ __clang__ 1"
    );
    assert_eq!(
        check(WINDOWS_X64, ids),
        "1 __aarch64__ __linux__ 1 __APPLE__ __LP64__ __CHAR_UNSIGNED__ __GNUC__ __clang__ 1"
    );
    assert_eq!(
        check(LINUX_X64, "__INT64_C(5) __UINT32_C(7) __INTMAX_MAX__"),
        "5L 7U 0x7fffffffffffffffL"
    );

    let options = CompileOptions {
        defines: vec![
            ("A".to_string(), None),
            ("B".to_string(), Some("b + 1".to_string())),
            ("C".to_string(), None),
        ],
        undefines: vec!["C".to_string(), "__linux__".to_string()],
        gnu_version: None,
        replace_aggregates: true,
        ..CompileOptions::new(LINUX_X64)
    };
    let text = preprocess(b"A B C __linux__", "t.c", &options).unwrap();
    assert_eq!(tokens_of(&text).join(" "), "1 b + 1 C __linux__");
}

#[test]
fn plain_char_is_unsigned_on_arm_linux() {
    checked_for(
        "#include <limits.h>\nint f(void) { return CHAR_MIN == 0 && CHAR_MAX == 255; }",
        LINUX_ARM64,
    );
}

// ───────────────────────────── language features ─────────────────────────────

/// What nothing uses is not in the module: only its absence from the listing shows it. (Which of these
/// an importer sees is fixtures/exports/inline-definitions-and-linkage.)
#[test]
fn dead_functions_and_unused_externs_are_not_emitted() {
    let src = "static int unused_static(int x) { return x; }
         static inline int unused_inline(int x) { return unused_static(x); }
         static int used_transitively(int x) { return x * 3; }
         static inline int helper(int x) { return used_transitively(x) + 1; }
         inline int inline_only(int x) { return x + 7; }
         int run(int x) { return helper(x) + inline_only(x); }";
    let text = disassemble(&crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(
        !has(&text, "unused_static") && !has(&text, "unused_inline"),
        "{text}"
    );
    assert!(has(&text, "used_transitively"), "{text}");
    let text = disassemble(&crate::compile(b"int puts(const char *); int printf(const char *, ...); int f(void) { return puts(\"x\"); }", "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(has(&text, "puts") && !has(&text, "printf"), "{text}");
}
