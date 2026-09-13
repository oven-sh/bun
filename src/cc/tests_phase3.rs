//! Tests for variadic function definitions, the bit-manipulation ops, `Trap`,
//! `__VA_OPT__` and the warning channel.

use crate::tests::{LINUX_ARM64, LINUX_X64, WINDOWS_X64, has};
use crate::{
    Arch, CompileOptions, Os, Severity, Target, compile, compile_with_warnings, disassemble,
};

fn dump(src: &str, target: Target) -> String {
    match compile(src.as_bytes(), "t.c", target) {
        Ok(bir) => disassemble(&bir).unwrap(),
        Err(d) => panic!("{}", d[0]),
    }
}

#[test]
fn va_arg_shape_on_other_targets() {
    let quad = crate::tests::error_for(
        "#include <stdarg.h>\nint f(int n, ...) { va_list ap; va_start(ap, n); return (int)va_arg(ap, long double); }",
        LINUX_ARM64,
    );
    assert!(has(&quad, "'long double' is not supported"), "{quad}");
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
