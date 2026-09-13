//! Tests for linking several translation units into one module.

use std::collections::BTreeMap;

use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, has};
use crate::{CompileOptions, FileProvider, Target, compile_many, disassemble, validate};

struct MemoryFiles(BTreeMap<&'static str, &'static str>);

impl FileProvider for MemoryFiles {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.get(path).map(|text| text.as_bytes().to_vec())
    }
}

fn link_for(
    units: &[(&str, &str)],
    headers: &[(&'static str, &'static str)],
    target: Target,
) -> Result<crate::Output, String> {
    let files = MemoryFiles(headers.iter().copied().collect());
    let options = CompileOptions {
        file_provider: &files,
        ..CompileOptions::new(target)
    };
    let units: Vec<(&[u8], &str)> = units
        .iter()
        .map(|(name, text)| (text.as_bytes(), *name))
        .collect();
    compile_many(&units, &options).map_err(|d| d[0].to_string())
}

fn link(units: &[(&str, &str)]) -> Result<crate::Output, String> {
    link_for(units, &[], LINUX_X64)
}

const SHARED_H: &str = "#ifndef SHARED_H
#define SHARED_H
struct point { int x, y; };
typedef int (*binary)(int, int);
extern int counter;
extern struct point origin;
extern const char *const names[3];
extern binary operations[3];
int scratch;                     /* a tentative definition in every unit */
int is_even(unsigned n);
int is_odd(unsigned n);
int add(int, int); int sub(int, int); int mul(int, int);
int bump(void);
const char *describe(int which);
int puts(const char *);
#endif
";

const MAIN_C: &str = "#include \"shared.h\"
int counter = 10;
struct point origin = { 3, 4 };
static int helper(void) { return 1; }
static int private_total;
int is_even(unsigned n) { return n == 0 ? 1 : is_odd(n - 1); }
int run_parity(unsigned n) { return is_even(n) * 10 + is_odd(n) + helper() * 100; }
int run_table(int a, int b) { int r = 0; for (int i = 0; i < 3; i++) r = r * 100 + operations[i](a, b); return r; }
int run_globals(void) {
    private_total += bump() + bump();
    scratch += 5;
    return counter * 1000 + private_total + origin.x * origin.y * 100000 + scratch * 1000000;
}
const char *run_names(int i) { puts(\"main\"); return describe(i); }
const char *own_string(void) { return \"from main\"; }
";

const PARITY_C: &str = "#include \"shared.h\"
static int helper(void) { return 2; }
static int private_total = 7;
int is_odd(unsigned n) { return n == 0 ? 0 : is_even(n - 1); }
int bump(void) { counter += helper(); private_total++; scratch++; return private_total; }
binary operations[3] = { add, sub, mul };
const char *own_string_too(void) { puts(\"parity\"); return \"from parity\"; }
";

const MATH_C: &str = "#include \"shared.h\"
static int helper(int x) { return x + scratch * 0; }
int add(int a, int b) { return helper(a) + b; }
int sub(int a, int b) { return a - b; }
int mul(int a, int b) { return a * b; }
const char *const names[3] = { \"zero\", \"one\", \"two\" };
const char *describe(int which) { return names[which]; }
";

#[test]
fn three_file_project() {
    let units = [
        ("main.c", MAIN_C),
        ("parity.c", PARITY_C),
        ("math.c", MATH_C),
    ];
    for target in [LINUX_X64, LINUX_ARM64, WINDOWS_X64] {
        let output = link_for(&units, &[("shared.h", SHARED_H)], target).expect("link");
        assert!(output.warnings.is_empty(), "{:?}", output.warnings);
        validate(&output.bir).expect("validate");
        let text = disassemble(&output.bir).unwrap();
        // The only thing left undefined is puts, once.
        let count = |needle: &str| {
            (0..text.len())
                .filter(|&i| text[i..].starts_with(needle))
                .count()
        };
        assert_eq!(count("\nextern "), 1, "{text}");
        assert!(has(&text, "extern 0: puts"), "{text}");
        assert_eq!(count("ExternAddr"), 0, "{text}");
        // Three private helpers, all kept; every cross-file call is direct.
        assert_eq!(count(" helper:") + count(" helper "), 3, "{text}");
        for name in ["run_parity", "is_even", "is_odd", "add", "describe", "bump"] {
            assert!(
                has(&text, &format!("export {name} ")),
                "missing export {name}\n{text}"
            );
        }
    }
}

/// (What cannot be linked at all is in test/js/bun/ffi/bir/multi-file.test.ts; nothing shows a warning yet.)
#[test]
fn link_warnings() {
    assert!(compile_many(&[], &CompileOptions::new(LINUX_X64)).is_err());

    // A declaration that disagrees with the definition: a warning, and the call still
    // passes what the caller was compiled to pass.
    let output = link(&[
        ("a.c", "long scale(long); int before(void) { return 1; } int f(int x) { int y = before(); return (int)scale(x) + y; } int g(int x) { return x > 0 ? (int)scale(x) * 2 : -1; }"),
        ("b.c", "int scale(int x) { return x * 3; }"),
    ])
    .expect("link");
    assert_eq!(output.warnings.len(), 1, "{:?}", output.warnings);
    assert!(has(
        &output.warnings[0].message,
        "'scale' is declared here with a different type"
    ));
    let text = disassemble(&output.bir).unwrap();
    assert!(has(&text, "CallIndirect"), "{text}");
    validate(&output.bir).expect("valid after renumbering");

    let output = link(&[
        ("a.c", "int big[8];"),
        ("b.c", "int big[2]; int f(void) { return big[1]; }"),
    ])
    .expect("link");
    assert!(
        has(
            &output.warnings[0].message,
            "'big' has size 8 here but size 32 in a.c"
        ),
        "{:?}",
        output.warnings
    );
    let text = disassemble(&output.bir).unwrap();
    assert!(has(&text, "data: size 32"), "{text}");
}

#[test]
fn undefined_symbols_are_shared_externs() {
    let output = link(&[
        ("a.c", "int printf(const char *, ...); extern int errno_like; int a(void) { return printf(\"a %d\\n\", errno_like); }"),
        ("b.c", "int printf(const char *, ...); extern int errno_like; int b(void) { return printf(\"b\\n\") + errno_like; }"),
    ])
    .expect("link");
    let text = disassemble(&output.bir).unwrap();
    let count = |needle: &str| {
        (0..text.len())
            .filter(|&i| text[i..].starts_with(needle))
            .count()
    };
    assert_eq!(count("\nextern "), 2, "{text}");
    assert!(
        has(&text, ": printf") && has(&text, ": errno_like data"),
        "{text}"
    );
}
