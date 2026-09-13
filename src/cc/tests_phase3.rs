//! Tests for variadic function definitions, the bit-manipulation ops, `Trap`,
//! `__VA_OPT__` and the warning channel.

use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, assert_error, checked, has};
use crate::{
    Arch, CompileOptions, Os, Severity, Target, compile, compile_with_warnings, disassemble,
    preprocess,
};

fn dump(src: &str, target: Target) -> String {
    match compile(src.as_bytes(), "t.c", target) {
        Ok(bir) => disassemble(&bir).unwrap(),
        Err(d) => panic!("{}", d[0]),
    }
}

#[test]
fn variadic_definitions() {
    checked(
        r#"#include <stdarg.h>
           #include <stddef.h>
           static int sum(int n, ...) { va_list ap; va_start(ap, n); int s = 0; for (int i = 0; i < n; i++) s += va_arg(ap, int); va_end(ap); return s; }
           int sum3(void) { return sum(3, 10, 20, 30); }
           int sum_many(void) { return sum(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
           int sum_none(void) { return sum(0); }
           static double mixed(const char *kinds, ...) {
               va_list ap; va_start(ap, kinds); double total = 0;
               for (; *kinds; kinds++) {
                   switch (*kinds) {
                   case 'i': total += va_arg(ap, int); break;
                   case 'l': total += (double)va_arg(ap, long); break;
                   case 'u': total += va_arg(ap, unsigned long long) >> 32; break;
                   case 'd': total += va_arg(ap, double); break;
                   case 's': total += (double)(va_arg(ap, const char *))[0]; break;
                   case 'p': total += *va_arg(ap, int *); break;
                   }
               }
               va_end(ap);
               return total;
           }
           double mixed_small(void) { int seven = 7; return mixed("idlsp", 1, 2.5, -3L, "A", &seven); }
           double mixed_promotions(void) { char c = 5; short s = -6; float f = 0.25f; unsigned char u = 200; return mixed("iidiu", c, s, f, u, 0xabcdef0100000000ull); }
           double many_doubles(void) { return mixed("dddddddddddd", 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0); }
           double interleaved(void) { return mixed("ididididididididididid", 1, 0.5, 2, 0.5, 3, 0.5, 4, 0.5, 5, 0.5, 6, 0.5, 7, 0.5, 8, 0.5, 9, 0.5, 10, 0.5, 11, 0.5); }
           static double after_floats(double a, float b, int n, ...) { va_list ap; va_start(ap, n); double s = a + b; while (n--) s += va_arg(ap, double); va_end(ap); return s; }
           double named_floats(void) { return after_floats(100.0, 10.0f, 8, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5); }
           static long after_ints(long a, long b, long c, long d, long e, long f, long g, int n, ...) { va_list ap; va_start(ap, n); long s = a + b + c + d + e + f + g; while (n--) s += va_arg(ap, long); va_end(ap); return s; }
           long named_on_stack(void) { return after_ints(1, 2, 3, 4, 5, 6, 7, 3, 100L, 200L, 300L); }
           static int twice(int n, ...) {
               va_list ap, copy; va_start(ap, n); va_copy(copy, ap);
               int a = 0, b = 0;
               for (int i = 0; i < n; i++) a += va_arg(ap, int);
               for (int i = 0; i < n; i++) b += va_arg(copy, int) * 2;
               va_end(copy); va_end(ap);
               return a * 1000 + b;
           }
           int copied(void) { return twice(8, 1, 2, 3, 4, 5, 6, 7, 8); }
           static int vsum(int n, va_list ap) { int s = 0; while (n--) s += va_arg(ap, int); return s; }
           static int forward(int n, ...) { va_list ap; va_start(ap, n); int first = va_arg(ap, int); int rest = vsum(n - 1, ap); va_end(ap); return first * 1000 + rest; }
           int forwarded(void) { return forward(9, 5, 1, 1, 1, 1, 1, 1, 1, 1); }
           int vsnprintf(char *, size_t, const char *, va_list);
           static int format(char *out, size_t n, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vsnprintf(out, n, fmt, ap); va_end(ap); return r; }
           int formatted(char *out) { return format(out, 64, "%d-%s-%.1f-%ld-%c", 42, "str", 2.5, 1234567890123L, 'x'); }
           int through_pointer(void) { int (*f)(int, ...) = sum; int (*table[])(int, ...) = { twice, sum }; return f(2, 40, 2) + table[1](1, 100); }
           int exported_variadic(int n, ...) { va_list ap; va_start(ap, n); int v = va_arg(ap, int); va_end(ap); return v; }
           int calls_exported(void) { return exported_variadic(1, 77); }
           static int c23_start(int n, ...) { va_list ap; va_start(ap); int v = va_arg(ap, int); va_end(ap); return v + n; }
           int c23(void) { return c23_start(1, 41); }
           static int cond_arg(int n, ...) { va_list ap; va_start(ap, n); int v = n > 0 ? va_arg(ap, int) + va_arg(ap, int) : -1; va_end(ap); return v; }
           int in_expression(void) { return cond_arg(1, 30, 12) + cond_arg(0); }"#,
    );
    // A variadic function keeps its exported flag but has no export entry: JS cannot call it.
    let text = dump(
        "int v(int n, ...) { return n; } int w(void) { return v(1, 2); }",
        LINUX_X64,
    );
    assert!(
        has(&text, " v (exported): sig 0 (i32, ...) -> i32"),
        "{text}"
    );
    assert!(
        !has(&text, "export v ") && has(&text, "export w "),
        "{text}"
    );
    assert!(has(&text, "Call 0 <v> (v"), "{text}");
    assert_error(
        "#include <stdarg.h>\nint f(int n) { va_list ap; va_start(ap, n); return 0; }",
        "does not take variable arguments",
    );
    assert_error(
        "#include <stdarg.h>\nint f(int n, ...) { int x; va_start(x, n); return 0; }",
        "expected a va_list",
    );
    let quad = crate::tests::error_for(
        "#include <stdarg.h>\nint f(int n, ...) { va_list ap; va_start(ap, n); return (int)va_arg(ap, long double); }",
        crate::tests::LINUX_ARM64,
    );
    assert!(has(&quad, "'long double' is not supported"), "{quad}");
}

#[test]
fn va_arg_shape_on_other_targets() {
    let src = "#include <stdarg.h>\n double f(int n, ...) { va_list ap, other; va_start(ap, n); va_copy(other, ap); int i = va_arg(ap, int); double d = va_arg(other, double); va_end(ap); return i + d; }";
    // AAPCS64: a 32-byte va_list; general arguments use gr_offs (+24) and gr_top (+8), floating
    // ones vr_offs (+28) and vr_top (+16), and both fall back to the stack pointer at +0.
    let arm = dump(src, LINUX_ARM64);
    assert!(has(&arm, "slot 0: size 32 align 8"), "{arm}");
    assert!(has(&arm, "VaStart"), "{arm}");
    for needle in [
        "Load i32 [v",
        "+ 24]",
        "+ 28]",
        "+ 8]",
        "+ 16]",
        "SExt32",
        "ConstI64 32",
    ] {
        assert!(has(&arm, needle), "missing {needle} in:\n{arm}");
    }
    // Apple arm64 and Win64: va_list is a pointer that steps by 8.
    for target in [
        Target {
            arch: Arch::Aarch64,
            os: Os::MacOs,
        },
        WINDOWS_X64,
    ] {
        let text = dump(src, target);
        assert!(
            has(&text, "slot 0: size 8 align 8") && has(&text, "VaStart"),
            "{text}"
        );
        assert!(has(&text, "ConstI64 8") && !has(&text, "Br "), "{text}");
        assert!(has(&text, "Load f64 [") && has(&text, "MemCopy"), "{text}");
    }
    // System V: gp_offset < 48, fp_offset < 176, overflow_arg_area at +8, reg_save_area at +16.
    let sysv = dump(src, LINUX_X64);
    for needle in [
        "slot 0: size 24 align 8",
        "ConstI32 48",
        "ConstI32 176",
        "ULt",
        "ConstI64 24",
    ] {
        assert!(has(&sysv, needle), "missing {needle} in:\n{sysv}");
    }
    // On aarch64-linux a va_list is a 32-byte struct, passed by reference to a caller copy.
    let forwarded = dump(
        "#include <stdarg.h>\nint v(int, va_list); int f(int n, ...) { va_list ap; va_start(ap, n); return v(n, ap); }",
        LINUX_ARM64,
    );
    assert!(
        has(&forwarded, "MemCopy") && has(&forwarded, "CallExtern 0 <v>"),
        "{forwarded}"
    );
}

#[test]
fn bit_manipulation_ops() {
    let src = "int clz(unsigned v) { return __builtin_clz(v); }
         int clzl(unsigned long v) { return __builtin_clzl(v); }
         int clzll(unsigned long long v) { return __builtin_clzll(v); }
         int ctz(unsigned v) { return __builtin_ctz(v); }
         int ctzl(unsigned long v) { return __builtin_ctzl(v); }
         int ctzll(unsigned long long v) { return __builtin_ctzll(v); }
         int pop(unsigned v) { return __builtin_popcount(v); }
         int popl(unsigned long v) { return __builtin_popcountl(v); }
         int popll(unsigned long long v) { return __builtin_popcountll(v); }
         unsigned short swap16(unsigned short v) { return __builtin_bswap16(v); }
         unsigned swap32(unsigned v) { return __builtin_bswap32(v); }
         unsigned long long swap64(unsigned long long v) { return __builtin_bswap64(v); }
         int folded(void) { return __builtin_popcount(0xff) + __builtin_ctz(8); }
         void die(int x) { if (x) __builtin_trap(); }
         int never(int x) { if (x) return 1; __builtin_unreachable(); }";
    checked(src);
    let text = dump(src, LINUX_X64);
    for op in [
        "Clz v",
        "Ctz v",
        "Popcnt v",
        "Bswap v",
        "Trap\n",
        "Unreachable\n",
    ] {
        assert!(has(&text, op), "missing {op:?} in:\n{text}");
    }
    // One instruction each: none of the shift-and-mask sequences are left.
    assert!(
        !has(&text, "ConstI32 1431655765") && !has(&text, "Mul"),
        "{text}"
    );
    // On LLP64 `long` is 32 bits, so the `l` forms are 32-bit operations.
    let win = dump(
        "int f(unsigned long v) { return __builtin_clzl(v) + __builtin_popcountl(v); }",
        WINDOWS_X64,
    );
    assert!(has(&win, ":i32 = Clz") && !has(&win, "Trunc"), "{win}");
}

#[test]
fn va_opt() {
    let pp = |src: &str| -> String {
        let text = preprocess(src.as_bytes(), "t.c", &CompileOptions::new(LINUX_X64)).unwrap();
        crate::tests_phase2::tokens_of(&text).join(" ")
    };
    assert_eq!(
        pp("#define F(a, ...) f(a __VA_OPT__(,) __VA_ARGS__)\nF(1) F(1, 2) F(1, 2, 3) F(1,)"),
        "f ( 1 ) f ( 1 , 2 ) f ( 1 , 2 , 3 ) f ( 1 )"
    );
    assert_eq!(
        pp("#define G(...) __VA_OPT__(x ## __VA_ARGS__ ## y)|\nG() G(1) G(a b)"),
        "| x1y | xa by |"
    );
    assert_eq!(
        pp("#define E\n#define H(...) [__VA_OPT__(yes)]\nH() H(E) H(E E) H(0)"),
        "[ ] [ ] [ ] [ yes ]"
    );
    assert_eq!(
        pp("#define S(...) #__VA_OPT__(a  __VA_ARGS__ b)\nS() S(1, 2)"),
        "\"\" \"a 1, 2 b\""
    );
    assert_eq!(
        pp("#define P(x, ...) x ## __VA_OPT__(_tail) __VA_OPT__() end\nP(a) P(a, 1)"),
        "a end a_tail end"
    );
    assert_eq!(
        pp("#define Q(x, ...) __VA_OPT__(pre_) ## x\nQ(a) Q(a, 1)"),
        "a pre_a"
    );
    assert_eq!(pp("#define N(x) __VA_OPT__(x)\nN(1)"), "__VA_OPT__ ( 1 )");
    assert_eq!(
        pp(
            "#define LOG(fmt, ...) printf(fmt __VA_OPT__(, __VA_ARGS__))\nLOG(\"a\") LOG(\"b %d\", (1, 2))"
        ),
        "printf ( \"a\" ) printf ( \"b %d\" , ( 1 , 2 ) )"
    );
}

#[test]
fn warnings_are_returned_not_fatal() {
    let src = b"#warning first thing\nint x;\n#if 0\n#warning skipped\n#endif\n  #  warning second \"quoted\" thing\nint f(void) { return 1; }\n";
    let output = match compile_with_warnings(src, "w.c", &CompileOptions::new(LINUX_X64)) {
        Ok(output) => output,
        Err(d) => panic!("{}", d[0]),
    };
    assert!(!output.bir.is_empty());
    let rendered: Vec<String> = output.warnings.iter().map(ToString::to_string).collect();
    assert_eq!(
        rendered,
        [
            "w.c:1:1: warning: #warning first thing",
            "w.c:6:3: warning: #warning second \"quoted\" thing"
        ]
    );
    assert!(
        output
            .warnings
            .iter()
            .all(|w| w.severity == Severity::Warning)
    );
    let failed = compile_with_warnings(
        b"#warning w\nint x = ;",
        "w.c",
        &CompileOptions::new(LINUX_X64),
    );
    let errors = failed.err().expect("an error");
    assert_eq!(errors[0].severity, Severity::Error);
    assert_eq!(
        errors[0].to_string(),
        "w.c:2:9: error: expected an expression before ';'"
    );
}
