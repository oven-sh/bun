//! Tests for the preprocessor, the builtin headers and the language features that real
//! headers need.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::lexer::Lexer;
use crate::tests::{
    LINUX_ARM64, LINUX_X64, WINDOWS_X64, assert_error, checked, checked_for, error, has,
};
use crate::token::{PpKind, TokenSource};
use crate::{
    CompileOptions, FileProvider, HostFiles, compile_with, default_system_include_dirs,
    disassemble, preprocess,
};

/// An in-memory file system.
struct MemoryFiles(BTreeMap<&'static str, &'static str>);

impl FileProvider for MemoryFiles {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.get(path).map(|text| text.as_bytes().to_vec())
    }
}

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

fn pp_text(src: &str) -> String {
    pp(src).join(" ")
}

fn pp_error(src: &str) -> String {
    match preprocess(src.as_bytes(), "test.c", &CompileOptions::new(LINUX_X64)) {
        Ok(text) => panic!("expected a preprocessing error, got:\n{text}"),
        Err(d) => format!("{}:{}:{}: {}", d[0].file, d[0].line, d[0].col, d[0].message),
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
fn macro_expansion_rules() {
    // Self-reference and mutual recursion stop (C11 6.10.3.4p2).
    assert_eq!(
        pp_text("#define foo foo + bar\n#define bar foo\nfoo bar"),
        "foo + foo foo + bar"
    );
    assert_eq!(
        pp_text("#define f(a) a*g\n#define g(a) f(a)\nf(2)(9)"),
        "2 * 9 * g"
    );
    // A function-like macro name without '(' is not an invocation.
    assert_eq!(pp_text("#define F(x) [x]\nF F (1) F\n(2)"), "F [ 1 ] [ 2 ]");
    // Arguments are fully expanded before substitution, except next to # and ##.
    assert_eq!(
        pp_text("#define A 1\n#define S(x) #x\n#define X(x) S(x)\nS(A) X(A)"),
        "\"A\" \"1\""
    );
    assert_eq!(
        pp_text("#define A 1\n#define C(x, y) x ## y\nC(A, A) C(A, 2)"),
        "AA A2"
    );
    // Stringification: spacing collapses, strings and chars are escaped.
    assert_eq!(
        pp_text("#define S(x) #x\nS(  a   +  \"b\\n\"  '\\''  )"),
        r#""a + \"b\\n\" '\\''""#
    );
    // Placemarkers.
    assert_eq!(
        pp_text("#define C(a, b, c) a ## b ## c\nC(1,,3) C(,,3) C(,,) |"),
        "13 3 |"
    );
    // Variadics, including GNU comma swallowing and named variadics.
    assert_eq!(
        pp_text("#define P(f, ...) p(f, ## __VA_ARGS__)\nP(a) P(a, b, c)"),
        "p ( a ) p ( a , b , c )"
    );
    assert_eq!(
        pp_text("#define P(f, args...) p(f , ## args)\nP(a) P(a, b)"),
        "p ( a ) p ( a , b )"
    );
    assert_eq!(
        pp_text("#define V(...) <__VA_ARGS__>\nV() V(1) V(1, (2, 3))"),
        "< > < 1 > < 1 , ( 2 , 3 ) >"
    );
    // Arguments that span lines and contain parentheses and commas.
    assert_eq!(
        pp_text("#define F(a, b) a|b\nF((1,\n2),\n  g(3, 4))"),
        "( 1 , 2 ) | g ( 3 , 4 )"
    );
    // Deferred expansion needs another scan.
    assert_eq!(
        pp_text(
            "#define E()\n#define D(x) x E()\n#define A() 1\n#define X(...) __VA_ARGS__\nD(A)() X(D(A)())"
        ),
        "A ( ) 1"
    );
    // Redefinition: identical is silent, different replaces the macro with a warning.
    assert_eq!(pp_text("#define A 1 + 2\n#define A 1  +  2\nA"), "1 + 2");
    assert_eq!(pp_text("#define A 1\n#define A 2\nA"), "2");
    assert_eq!(pp_text("#define F(x) x\n#define F(y) y y\nF(1)"), "1 1");
    let redefined = crate::compile_with_warnings(
        b"#define A 1\n#define A 2\nint a = A;",
        "test.c",
        &CompileOptions::new(LINUX_X64),
    )
    .unwrap();
    assert_eq!(
        redefined.warnings[0].to_string(),
        "test.c:2:9: warning: 'A' redefined with a different definition"
    );
    assert_eq!(pp_text("#define A 1\n#undef A\n#define A 2\nA"), "2");
    // Errors.
    assert!(has(
        &pp_error("#define F(a, b) a\nF(1)"),
        "requires 2 arguments, but 1 given"
    ));
    assert!(has(
        &pp_error("#define F(a) a\nF(1"),
        "unterminated argument list invoking macro 'F'"
    ));
    assert!(has(
        &pp_error("#define C(a, b) a ## b\nC(+, /)"),
        "does not give a valid preprocessing token"
    ));
    assert!(has(
        &pp_error("#define S(x) # y"),
        "'#' is not followed by a macro parameter"
    ));
    assert!(has(
        &pp_error("#define P ## x"),
        "'##' cannot appear at either end"
    ));
    // Builtin macros.
    assert_eq!(
        pp_text(
            "__LINE__\n\n__LINE__ __FILE__ __INCLUDE_LEVEL__ __COUNTER__ __COUNTER__ __STDC__ __STDC_VERSION__"
        ),
        "1 3 \"test.c\" 0 0 1 1 201112L"
    );
    assert_eq!(
        pp_text("#line 100 \"other.c\"\n__LINE__ __FILE__\n__LINE__"),
        "100 \"other.c\" 101"
    );
    assert_eq!(pp_text("#define L __LINE__\n\nL"), "3");
    assert_eq!(pp("__DATE__ __TIME__")[0].len(), 13);
    assert_eq!(
        pp_text("_Pragma(\"once\") a _Pragma(\"GCC diagnostic push\") b"),
        "a b"
    );
}

#[test]
fn conditional_directives() {
    let src = "#if defined(A) && A > 1\nyes1\n#elif !defined B\nyes2\n#else\nno\n#endif\n\
               #ifdef A\nno\n#elifdef A\nno\n#elifndef A\nyes3\n#endif\n\
               #ifndef A\nyes4\n#endif";
    assert_eq!(pp_text(src), "yes2 yes3 yes4");
    assert_eq!(pp_text(&format!("#define A 5\n{src}")), "yes1 no");
    // Arithmetic is done in intmax_t/uintmax_t.
    assert_eq!(pp_text("#if -1 < 0u\nu\n#else\ns\n#endif"), "s");
    assert_eq!(pp_text("#if -1 < 0\ns\n#endif"), "s");
    assert_eq!(
        pp_text(
            "#if (2 + 3) * 4 == 20 && 7 / 2 == 3 && -7 % 3 == -1 && (1 << 62) > 0 && 0x7fffffffffffffff + 1u > 0\nok\n#endif"
        ),
        "ok"
    );
    assert_eq!(
        pp_text("#if 'a' == 97 && '\\n' == 10 && '\\377' < 0\nok\n#endif"),
        "ok"
    );
    assert_eq!(pp_text("#if 1 ? 2 : (1 / 0)\nok\n#endif"), "ok");
    assert_eq!(pp_text("#if 0 && (1 / 0)\n#else\nok\n#endif"), "ok");
    assert_eq!(
        pp_text("#if defined(X) && X(1, 2)\n#else\nok\n#endif"),
        "ok"
    );
    assert_eq!(
        pp_text("#if UNKNOWN == 0 && !true_is_unknown\nok\n#endif"),
        "ok"
    );
    assert_eq!(
        pp_text("#define D defined(Z)\n#define Z\n#if D\nok\n#endif"),
        "ok"
    );
    assert!(has(&pp_error("#if 1 / 0\n#endif"), "division by zero"));
    assert!(has(&pp_error("#if 1 +\n#endif"), "expected a value"));
    assert!(has(&pp_error("#if 1.5\n#endif"), "floating constant"));
    assert!(has(&pp_error("#if 1 2\n#endif"), "missing binary operator"));
    assert!(has(&pp_error("#endif"), "#endif without #if"));
    assert!(has(&pp_error("#else"), "#else without #if"));
    assert!(has(
        &pp_error("#if 1\n#else\n#else\n#endif"),
        "#else after #else"
    ));
    assert!(has(
        &pp_error("#if 1\nx"),
        "test.c:1:1: unterminated conditional directive"
    ));
    // Skipped groups are lexed loosely and their directives ignored.
    assert_eq!(
        pp_text(
            "#if 0\n#error don't\n'unterminated \"x\n#bogus\n#include <nothing.h>\n#if 1\n#else\n#endif\n#else\nok\n#endif"
        ),
        "ok"
    );
    assert!(has(
        &pp_error("\n#error stop here"),
        "test.c:2:1: #error stop here"
    ));
    assert!(has(
        &pp_error("#bogus"),
        "invalid preprocessing directive #bogus"
    ));
    assert_eq!(
        pp_text("#\n# 12 \"x.c\"\n#pragma whatever\n#warning ignored\n#ident \"v\"\n__LINE__"),
        "15"
    );
    // Feature tests.
    assert_eq!(
        pp_text(
            "#ifdef __has_include\n#if __has_include(<stddef.h>) && !__has_include(\"nope.h\") && !__has_include(<nope.h>)\nok\n#endif\n#endif"
        ),
        "ok"
    );
    assert_eq!(
        pp_text(
            "#if __has_builtin(__builtin_expect) && !__has_builtin(__builtin_nope) && !__has_attribute(packed) && !__has_feature(x) && !__has_extension(x) && !__has_c_attribute(x) && !__has_cpp_attribute(x) && !__has_warning(\"-Wx\")\nok\n#endif"
        ),
        "ok"
    );
    // A stray quote outside a skipped group only matters if it reaches the parser.
    assert_eq!(pp_text("#define EAT(x)\nEAT(\ndon't\n)\nok"), "ok");
    assert!(has(
        &error("int x = 'a;"),
        "unterminated character constant"
    ));
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
fn includes_through_a_file_provider() {
    let files = MemoryFiles(BTreeMap::from([
        (
            "inc/a.h",
            "#pragma once\n#include \"b.h\"\nint a_value = B_VALUE;\n",
        ),
        (
            "inc/b.h",
            "#ifndef B_H\n#define B_H\n#define B_VALUE 40\n#endif\n",
        ),
        ("sys/chain.h", "#define CHAIN 1\n#include_next <chain.h>\n"),
        ("sys2/chain.h", "#define CHAIN2 (CHAIN + 1)\n"),
        ("sys2/stddef.h", "#error the builtin stddef.h must win\n"),
        ("sys2/limits.h", "#define PATH_MAX 4096\n"),
        ("src/local.h", "#define LOCAL 2\n#include <a.h>\n"),
        ("inc/bad.h", "\n\nint bad = ;\n"),
        ("inc/loop.h", "#include \"loop.h\"\n"),
        (
            "inc/where.h",
            "const char *where = __FILE__; int level = __INCLUDE_LEVEL__;\n",
        ),
    ]));
    let options = CompileOptions {
        include_dirs: vec!["inc".to_string()],
        system_include_dirs: vec!["sys".to_string(), "sys2".to_string()],
        file_provider: &files,
        ..CompileOptions::new(LINUX_X64)
    };
    let src = "#include \"local.h\"\n#include <a.h>\n#include \"a.h\"\n#include <chain.h>\n#include <stddef.h>\n#include <limits.h>\n\
               #define HEADER <b.h>\n#include HEADER\n#define QUOTED \"b.h\"\n#include QUOTED\n\
               #if __has_include(<chain.h>) && __has_include(\"local.h\") && !__has_include(<local.h>) && __has_include_next(<limits.h>)\n\
               int total(void) { return a_value + LOCAL + CHAIN2 + (PATH_MAX == 4096) + (INT_MAX == 2147483647) + (int)sizeof(size_t); }\n#endif\n";
    if let Err(d) = compile_with(src.as_bytes(), "src/main.c", &options) {
        panic!("{}", d[0]);
    }
    let error_in = |src: &str| match compile_with(src.as_bytes(), "src/main.c", &options) {
        Ok(_) => panic!("expected an error"),
        Err(d) => d[0].to_string(),
    };
    // Diagnostics carry the file they happened in.
    assert_eq!(
        error_in("#include <bad.h>"),
        "inc/bad.h:3:11: error: expected an expression before ';'"
    );
    assert_eq!(
        error_in("int x;\n#include <missing.h>"),
        "src/main.c:2:2: error: 'missing.h' file not found"
    );
    assert!(has(
        &error_in("#include \"loop.h\""),
        "#include nested too deeply"
    ));
    assert!(has(&error_in("#include"), "#include expects"));
    // A token that comes from a macro body is reported where the macro was used.
    assert_eq!(
        error_in("#define BAD int y = ;\n\n  BAD"),
        "src/main.c:3:3: error: expected an expression before ';'"
    );
    let text = preprocess(b"#include <where.h>", "src/main.c", &options).unwrap();
    assert_eq!(
        tokens_of(&text).join(" "),
        "const char * where = \"inc/where.h\" ; int level = 1 ;"
    );
}

#[test]
fn builtin_headers() {
    checked(
        "#include <stddef.h>\n#include <stdint.h>\n#include <stdbool.h>\n#include <limits.h>\n#include <float.h>\n#include <stdalign.h>\n#include <stdnoreturn.h>\n#include <iso646.h>\n#include <stdarg.h>\n
         struct S { char c; int64_t v; };
         int sizes(void) { return sizeof(int8_t) + sizeof(int16_t) * 10 + sizeof(uint32_t) * 100 + sizeof(int64_t) * 1000 + sizeof(uintptr_t) * 10000 + sizeof(intmax_t) * 100000 + sizeof(size_t) * 1000000 + sizeof(wchar_t) * 10000000; }
         int limits(void) { return (INT_MAX == 2147483647) + (INT_MIN == -2147483647 - 1) + (UINT_MAX == 4294967295u) + (LONG_MAX == 9223372036854775807L) + (CHAR_BIT == 8) + (SCHAR_MIN == -128) + (UCHAR_MAX == 255) + (SHRT_MAX == 32767) + (LLONG_MIN < 0) + (ULLONG_MAX == 18446744073709551615ULL) + (CHAR_MIN < 0); }
         int stdint_limits(void) { return (INT8_MIN == -128) + (UINT16_MAX == 65535) + (INT32_MAX == 2147483647) + (INT64_MIN == -9223372036854775807LL - 1) + (UINT64_MAX == 18446744073709551615ull) + (SIZE_MAX == UINT64_MAX) + (INTPTR_MIN < 0) + (UINT64_C(1) << 40 == 1099511627776) + (sizeof(INT64_C(1)) == 8) + (PTRDIFF_MAX == INT64_MAX); }
         int misc(void) { bool t = true; return offsetof(struct S, v) + (NULL == 0) + t + (not false) + alignof(double) * 100 + (FLT_DIG == 6) + (DBL_MANT_DIG == 53) + (DBL_MAX > 1e300) + (FLT_EPSILON < 1e-6f) + (1 and 1) + (5 bitand 4); }
         noreturn void die(void);
         alignas(32) static char buffer[3];
         int aligned(void) { return (int)((uintptr_t)buffer % 32); }
         int takes_va_list(const char *fmt, va_list ap);",
    );
    checked_for(
        "#include <stdint.h>\n#include <limits.h>\n#include <stddef.h>\nint f(void) { return sizeof(long) + sizeof(int64_t) * 10 + sizeof(wchar_t) * 100 + (LONG_MAX == 2147483647) * 1000; }",
        WINDOWS_X64,
    );
    checked_for(
        "#include <limits.h>\nint f(void) { return CHAR_MIN == 0 && CHAR_MAX == 255; }",
        LINUX_ARM64,
    );
}

// ───────────────────────────── language features ─────────────────────────────

#[test]
fn bit_fields() {
    checked(
        "struct Flags { unsigned a : 1; unsigned b : 3; int c : 4; unsigned : 0; unsigned d : 9; _Bool e : 1; long long big : 40; };
         struct Mixed { char tag; int x : 5; int y : 11; short s; unsigned z : 17; };
         struct Packed { unsigned a : 3, b : 5, c : 8; } __attribute__((packed));
         static struct Flags g = { 1, 5, -3, 300, 1, -2 };
         static struct Flags g2 = { .d = 511, .c = 7 };
         int layout(void) { return sizeof(struct Flags) * 10000 + sizeof(struct Mixed) * 100 + sizeof(struct Packed); }
         int read_static(void) { return g.a + g.b * 10 + g.c * 100 + g.d * 1000 + g.e * 1000000 + (int)g.big * 10000000 + g2.d + g2.c; }
         int write(int v) {
             struct Flags f = { 0 };
             f.a = v; f.b = v; f.c = v; f.d = v; f.e = v; f.big = -1;
             f.b += 1; f.c--; ++f.d;
             return f.a + f.b * 10 + f.c * 100 + f.d * 1000 + f.e * 1000000 + (f.big == -1) * 10000000;
         }
         int neighbours(void) { struct Mixed m = { 'q', -1, 1023, -5, 70000 }; m.x = 3; m.z = 99999; return m.tag + m.x + m.y + m.s + (int)m.z; }
         int value_of_assignment(void) { struct Flags f; int r = (f.b = 13); int s = (f.c = 9); return r * 100 + s; }
         int promotes(void) { struct Flags f; f.b = 1; f.d = 1; return (f.b - 2 < 0) + (f.d - 2 < 0) + (sizeof(f.b + 0) == 4); }
         unsigned char raw(void) { union { struct Packed p; unsigned char bytes[2]; } u = { { 5, 9, 0xab } }; return u.bytes[0]; }
         int through_pointer(struct Flags *p) { p->d = 77; p->a ^= 1; return p->d + p->a; }
         int local_designated(void) { struct Flags f = { .c = -8, .a = 1, .big = 1LL << 38 }; return f.c + f.a + (int)(f.big >> 38) * 100; }
         int call_through(void) { struct Flags f = { 0 }; return through_pointer(&f); }",
    );
    assert_error(
        "struct S { int a : 3; } s; int *p = &s.a;",
        "address of a bit-field",
    );
    assert_error("struct S { int a : 33; };", "exceeds its type");
    assert_error("struct S { float a : 3; };", "non-integer type");
    assert_error("struct S { int a : 0; };", "cannot have zero width");
}

#[test]
fn gnu_and_c11_expression_forms() {
    checked(
        "#include <stddef.h>
         struct P { int x, y; };
         static int sum(const int *v, int n) { int s = 0; while (n--) s += v[n]; return s; }
         static int len2(struct P *p) { return p->x * p->x + p->y * p->y; }
         static const int *table = (const int[]){ 4, 5, 6 };
         static struct P origin = (struct P){ 1, 2 };
         int compound(int k) { int *p = (int[]){ k, k + 1, k + 2 }; p[1] += 10; return sum(p, 3) + len2(&(struct P){ 3, k }) + (struct P){ .y = 7 }.y + table[2] + origin.y + *(int *)&(int){ 9 }; }
         int compound_in_loop(void) { int s = 0; for (int i = 0; i < 3; i++) { struct P *p = &(struct P){ i, 0 }; p->y += 5; s += p->x + p->y; } return s; }
         int stmt_expr(int a) { int r = ({ int t = a * 2; if (t > 10) t = 10; t + 1; }); ({ r++; }); return r + ({ 5; }); }
         #define MAX(a, b) ({ __typeof__(a) _a = (a); __typeof__(b) _b = (b); _a > _b ? _a : _b; })
         int max3(int a, int b, int c) { int calls = 0; int m = MAX(MAX(a, (calls++, b)), c); return m * 10 + calls; }
         int elvis(int a, int b) { return a ?: b; }
         int elvis_once(void) { int n = 0; int v = (++n, n) ?: 100; const char *s = (const char *)0 ?: \"x\"; return v * 10 + n + s[0]; }
         int ranges(int c) { switch (c) { case 'a' ... 'z': return 1; case 'A' ... 'Z': return 2; case '0' ... '9': return 3; case 1000 ... 100000: return 4; case -5 ... -1: return 5; default: return 0; } }
         #define kind(x) _Generic((x), int: 1, unsigned: 2, long: 3, double: 4, float: 5, char *: 6, const char *: 7, struct P: 8, default: 9)
         int generic(void) { char buf[2]; struct P p; short s = 0; return kind(1) + kind(1u) * 10 + kind(1L) * 100 + kind(1.0) * 1000 + kind(1.0f) * 10000 + kind(buf) * 100000 + kind(\"s\") * 1000000 + kind(p) * 10000000 + kind(s) * 100000000; }
         typedef __typeof__(sizeof 0) my_size; typeof(int *) ip; __typeof__(origin) other_origin;
         int typeofs(void) { int x = 3; typeof(x) y = x + 1; __typeof__(&x) px = &y; typeof(int[4]) arr; return *px + sizeof(my_size) + sizeof arr + sizeof other_origin; }
         int builtins(unsigned v) { return __builtin_expect(v > 3, 0) + __builtin_constant_p(5) * 10 + __builtin_constant_p(v) * 100 + (int)__builtin_offsetof(struct P, y) * 1000 + __builtin_types_compatible_p(int, signed int) * 10000 + __builtin_types_compatible_p(int, long) * 100000; }
         int offsets(void) { struct N { char c; struct { short s; int a[5]; } in; }; return offsetof(struct N, in.a[3]) + offsetof(struct N, in.s) * 100; }
         int bits(unsigned v, unsigned long long w) { return __builtin_popcount(v) + __builtin_clz(v) * 100 + __builtin_ctz(v) * 10000 + __builtin_popcountll(w) * 1000000 + __builtin_clzll(w) * 10000000; }
         int bits2(unsigned long long w) { return __builtin_ctzll(w) + __builtin_ctzl(w) * 100; }
         unsigned swap32(unsigned v) { return __builtin_bswap32(v); }
         unsigned short swap16(unsigned short v) { return __builtin_bswap16(v); }
         unsigned long long swap64(unsigned long long v) { return __builtin_bswap64(v); }
         int unreachable(int x) { if (x > 0) return 1; if (x <= 0) return 2; __builtin_unreachable(); }
         unsigned long long builtin_lib(const char *s) { char buf[8]; __builtin_memset(buf, 0, 8); __builtin_memcpy(buf, s, 3); return __builtin_strlen(buf) + __builtin_abs(-40); }
         double inf(void) { return __builtin_inf() > 1e308 && __builtin_nanf(\"\") != __builtin_nanf(\"\") ? __builtin_huge_val() : 0; }
         __extension__ typedef long long ext_ll;
         int extension(void) { __extension__ int x = 1; return __extension__ (x + 1) + (int)sizeof(__extension__ (ext_ll)0); }",
    );
    assert_error(
        "int f(int x) { return _Generic(x, long: 1); }",
        "not compatible with any association",
    );
    assert_error(
        "int f(int c) { switch (c) { case 1 ... 5: case 3: return 1; } return 0; }",
        "duplicate case",
    );
    assert_error(
        "int f(int c) { switch (c) { case 5 ... 1: return 1; } return 0; }",
        "empty case range",
    );
}

#[test]
fn wide_and_unicode_literals() {
    checked(
        "#include <stddef.h>
         static const wchar_t hello[] = L\"h\\u00e9llo\";
         static const unsigned short utf16[] = u\"a\\U0001F600\";
         static const unsigned int utf32[] = U\"\\x41\" U\"b\";
         int wide(void) { const wchar_t *w = L\"ab\" \"c\"; return sizeof hello / sizeof hello[0] * 1000 + hello[1] + w[2] + (L'x' == 120) + sizeof(L'x') * 100000; }
         int sixteen(void) { return sizeof utf16 / 2 * 100000 + utf16[1] - 0xd800 + (utf16[2] - 0xdc00) * 10 + (int)sizeof(u'x'); }
         int thirtytwo(void) { return utf32[0] + utf32[1] + (int)(sizeof utf32) * 1000 + (U'\\U0001F600' == 0x1F600); }
         int utf8(void) { const char *s = u8\"\\u00e9\"; return (unsigned char)s[0] * 1000 + (unsigned char)s[1]; }",
    );
    checked_for(
        "int f(void) { return sizeof(L'x') * 10 + sizeof(L\"ab\"); }",
        WINDOWS_X64,
    );
}

#[test]
fn attributes_alignment_and_asm_labels() {
    let src = "#include <stdint.h>
         struct __attribute__((packed)) Wire { char tag; int value; short tail; };
         struct Over { char c; } __attribute__((aligned(16)));
         struct Inner { char a; int b __attribute__((packed)); char c __attribute__((aligned(8))); };
         struct [[gnu::packed]] Ignored { char a; int b; };
         static int aligned_global __attribute__((aligned(64))) = 5;
         static _Alignas(32) char aligned_array[5];
         __attribute__((noinline, unused)) static int helper(int x) __attribute__((const));
         static int helper(int x) { return x + 1; }
         extern int renamed_function(int) __asm__(\"abs\");
         extern int renamed_variable __asm__(\"counter_elsewhere\");
         int (*__attribute__((cdecl)) fp)(int) = 0;
         [[nodiscard]] int layout(void) { return sizeof(struct Wire) + sizeof(struct Over) * 100 + _Alignof(struct Over) * 10000 + sizeof(struct Inner) * 1000000 + sizeof(struct Ignored) * 100000000; }
         int alignment(void) { __attribute__((aligned(128))) char local[3]; alignas(64) int other = 1; return (int)((uintptr_t)&aligned_global % 64 + (uintptr_t)aligned_array % 32 + (uintptr_t)local % 128 + (uintptr_t)&other % 64) + other; }
         int packed_access(void) { struct Wire w = { 1, 0x01020304, -2 }; struct Wire *p = &w; p->value += 1; return p->value + p->tail + (int)((char *)&p->value - (char *)p); }
         int calls(int x) { renamed_variable = 3; return helper(x) + renamed_function(-x) + renamed_variable; }
         int fallthrough(int x) { switch (x) { case 1: x++; __attribute__((fallthrough)); case 2: x++; [[fallthrough]]; default: x++; } return x; }
         int label_attr(void) { goto done; done: __attribute__((unused)); return 1; }
         enum __attribute__((packed)) E { A __attribute__((deprecated)) = 3, B };
         void __attribute__((noreturn)) never(void);
         static inline __attribute__((always_inline)) int twice(int x) { return 2 * x; }
         int use_twice(int x) { return twice(x) + B; }";
    checked(src);
    let text = disassemble(&crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(has(&text, ": abs sig"), "{text}");
    assert!(has(&text, ": counter_elsewhere data"), "{text}");
    assert!(!has(&text, "renamed_"), "{text}");
}

#[test]
fn inline_semantics_and_dead_function_removal() {
    let src = "static int unused_static(int x) { return x; }
         static inline int unused_inline(int x) { return unused_static(x); }
         static int used_by_table(int x) { return x + 100; }
         static int used_transitively(int x) { return x * 3; }
         static inline int helper(int x) { return used_transitively(x) + 1; }
         static int (*const table[])(int) = { used_by_table };
         inline int inline_only(int x) { return x + 7; }
         extern inline int extern_inline(int x) { return x + 8; }
         inline int declared_plain(int x) { return x + 9; }
         int declared_plain(int x);
         static int address_taken(int x) { return -x; }
         int run(int x) { int (*f)(int) = address_taken; return helper(x) + table[0](x) + inline_only(x) + f(x); }";
    checked(src);
    let text = disassemble(&crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(
        !has(&text, "unused_static") && !has(&text, "unused_inline"),
        "{text}"
    );
    assert!(
        has(&text, "used_by_table") && has(&text, "used_transitively"),
        "{text}"
    );
    // An inline definition is emitted because it is called, but not exported.
    assert!(
        has(&text, " inline_only:") && !has(&text, "export inline_only"),
        "{text}"
    );
    assert!(
        has(&text, "export extern_inline")
            && has(&text, "export declared_plain")
            && has(&text, "export run"),
        "{text}"
    );
    // Externs that nothing references are not declared.
    let text = disassemble(&crate::compile(b"int puts(const char *); int printf(const char *, ...); int f(void) { return puts(\"x\"); }", "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(has(&text, "puts") && !has(&text, "printf"), "{text}");
}

#[test]
fn wide_types_can_be_declared_but_not_computed() {
    checked(
        "typedef long double ld_t;
         struct Holder { char c; long double ld; __int128 big; _Complex double z; float _Complex fz; };
         long double strtold(const char *, char **);
         __int128 add128(__int128, unsigned __int128);
         struct div_result { int quot, rem; };
         struct div_result div(int, int);
         static ld_t stored;
         static struct Holder a, b;
         int sizes(void) { return sizeof(long double) + sizeof(struct Holder) * 100 + _Alignof(long double) * 100000 + sizeof(__int128_t) * 1000000 + sizeof(double _Complex) * 100000000; }
         int copy(void) { a.c = 5; b = a; struct Holder local = b; long double *p = &stored; (void)p; return local.c; }",
    );
    checked_for(
        "int f(void) { long double x = 1.5L; x += 1; return (int)(x * 2) + sizeof x; }",
        crate::Target {
            arch: crate::Arch::Aarch64,
            os: crate::Os::MacOs,
        },
    );
}

// ───────────────────────────── real headers and programs ─────────────────────────────

/// Compile options for this machine's C library, or `None` when it has no headers.
fn host_options() -> Option<CompileOptions<'static>> {
    let dirs = default_system_include_dirs(LINUX_X64);
    if !cfg!(all(target_os = "linux", target_arch = "x86_64"))
        || !std::path::Path::new("/usr/include/stdio.h").exists()
    {
        return None;
    }
    Some(CompileOptions {
        system_include_dirs: dirs,
        file_provider: &HostFiles,
        ..CompileOptions::new(LINUX_X64)
    })
}

const SYSTEM_HEADERS: &[&str] = &[
    "stdio.h",
    "stdlib.h",
    "string.h",
    "stdint.h",
    "inttypes.h",
    "math.h",
    "ctype.h",
    "errno.h",
    "assert.h",
    "limits.h",
    "float.h",
    "stdbool.h",
    "stddef.h",
    "time.h",
    "unistd.h",
    "sys/types.h",
    "sys/stat.h",
    "fcntl.h",
    "signal.h",
    "setjmp.h",
    "pthread.h",
    "wchar.h",
    "locale.h",
];

#[test]
fn system_headers_compile_one_by_one_and_together() {
    let Some(options) = host_options() else {
        return;
    };
    let mut all = String::new();
    for header in SYSTEM_HEADERS {
        let src = format!(
            "#include <{header}>\nint after_{}(void) {{ return 1; }}\n",
            header.len()
        );
        if let Err(d) = compile_with(src.as_bytes(), "one.c", &options) {
            panic!("<{header}>: {}", d[0]);
        }
        all.push_str(&format!("#include <{header}>\n"));
    }
    all.push_str(
        "int everything(void) { return EOF + (int)sizeof(struct stat) * 0 + (SIGINT == 2); }\n",
    );
    if let Err(d) = compile_with(all.as_bytes(), "all.c", &options) {
        panic!("{}", d[0]);
    }
}

// The expected values below come from building the same sources with the system compiler.

#[test]
fn runaway_preprocessing_is_an_error_not_a_hang() {
    let mut doubling = String::from("#define X0 x\n");
    for i in 1..40 {
        doubling.push_str(&format!("#define X{i} X{} X{}\n", i - 1, i - 1));
    }
    doubling.push_str("X39\n");
    assert!(has(
        &pp_error(&doubling),
        "macro expansion produces too many tokens"
    ));
    let nested = format!("#define F(x) x\n{}1{}", "F(".repeat(5000), ")".repeat(5000));
    assert!(has(
        &pp_error(&nested),
        "macro expansion is nested too deeply"
    ));
    let mut chain = String::new();
    for i in 0..30000 {
        chain.push_str(&format!("#define C{i} C{}\n", i + 1));
    }
    chain.push_str("C0");
    assert!(has(&pp_error(&chain), "nested too deeply"));
    assert_eq!(pp_text("#define R R R\nR"), "R R");
    let open_ifs = "#if 1\n".repeat(100_000);
    assert!(has(
        &pp_error(&open_ifs),
        "unterminated conditional directive"
    ));
}
