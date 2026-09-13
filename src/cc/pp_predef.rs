//! Predefined macros for a target, written as `#define` lines.

use std::fmt::Write as _;

use crate::types::{Arch, Os, Target};

pub(crate) fn predefined_macros(target: Target, gnu_version: Option<(u32, u32, u32)>) -> String {
    let mut out = String::new();
    let mut def = |name: &str, value: &str| {
        let _ = writeln!(out, "#define {name} {value}");
    };
    let windows = target.os == Os::Windows;
    let lp64 = !windows;
    let char_signed = target.char_is_signed();
    // long double is x87 extended on x86-64 SysV, IEEE quad on aarch64 Linux, double elsewhere.
    let long_double_bytes = match (target.arch, target.os) {
        (_, Os::Windows) | (Arch::Aarch64, Os::MacOs) => 8,
        _ => 16,
    };

    def("__STDC__", "1");
    def("__STDC_VERSION__", "201112L");
    def("__STDC_HOSTED__", "1");
    def("__STDC_UTF_16__", "1");
    def("__STDC_UTF_32__", "1");
    def("__STDC_NO_THREADS__", "1");
    def("__BUN_CC__", "1");
    if let Some((major, minor, patch)) = gnu_version {
        def("__GNUC__", &major.to_string());
        def("__GNUC_MINOR__", &minor.to_string());
        def("__GNUC_PATCHLEVEL__", &patch.to_string());
        def("__GNUC_STDC_INLINE__", "1");
        def(
            "__VERSION__",
            &format!("\"bun-cc (compatible with GNU C {major}.{minor}.{patch})\""),
        );
        // Code is always optimized by the backend; `__NO_INLINE__` stays undefined.
        def("__OPTIMIZE__", "1");
    }
    // Every lock-free size up to 8 bytes; there is no 16-byte compare-and-swap.
    for name in [
        "BOOL", "CHAR", "CHAR16_T", "CHAR32_T", "WCHAR_T", "SHORT", "INT", "LONG", "LLONG",
        "POINTER",
    ] {
        def(&format!("__GCC_ATOMIC_{name}_LOCK_FREE"), "2");
    }
    def("__GCC_ATOMIC_TEST_AND_SET_TRUEVAL", "1");
    for size in [1, 2, 4, 8] {
        def(&format!("__GCC_HAVE_SYNC_COMPARE_AND_SWAP_{size}"), "1");
    }
    for (value, name) in [
        "RELAXED", "CONSUME", "ACQUIRE", "RELEASE", "ACQ_REL", "SEQ_CST",
    ]
    .iter()
    .enumerate()
    {
        def(&format!("__ATOMIC_{name}"), &value.to_string());
    }

    match target.arch {
        Arch::X86_64 => {
            for name in ["__x86_64__", "__x86_64", "__amd64__", "__amd64"] {
                def(name, "1");
            }
            // What <xmmintrin.h>, <emmintrin.h>, <tmmintrin.h> and <smmintrin.h> provide.
            for name in ["__SSE__", "__SSE2__", "__SSSE3__", "__SSE4_1__"] {
                def(name, "1");
            }
        }
        Arch::Aarch64 => {
            def("__aarch64__", "1");
            def("__ARM_64BIT_STATE", "1");
            def("__ARM_ARCH", "8");
            def("__ARM_ARCH_ISA_A64", "1");
            def("__ARM_NEON", "1");
        }
    }
    match target.os {
        Os::Linux => {
            for name in [
                "__linux__",
                "__linux",
                "linux",
                "__gnu_linux__",
                "__unix__",
                "__unix",
                "unix",
                "__ELF__",
            ] {
                def(name, "1");
            }
            // glibc only defines these for GNU C (as which it defines them itself), and some of its headers (<spawn.h>) use
            // them unguarded. Declarations can carry an assembler name here, so they are
            // exactly what <sys/cdefs.h> would have defined.
            let redirects: &[&str] = if gnu_version.is_some() {
                &[]
            } else {
                &["__REDIRECT", "__REDIRECT_NTH", "__REDIRECT_NTHNL"]
            };
            for name in redirects {
                def(
                    &format!("{name}(name, proto, alias)"),
                    "name proto __asm__(#alias)",
                );
            }
        }
        Os::MacOs => {
            def("__APPLE__", "1");
            def("__MACH__", "1");
            // What <TargetConditionals.h> takes as the sign of a compiler it knows.
            def("__APPLE_CC__", "6000");
            if target.arch == Arch::Aarch64 {
                def("__arm64__", "1");
                def("__arm64", "1");
            }
        }
        Os::Windows => {
            def("_WIN32", "1");
            def("_WIN64", "1");
            if target.arch == Arch::X86_64 {
                def("_M_X64", "100");
                def("_M_AMD64", "100");
            } else {
                def("_M_ARM64", "1");
            }
        }
    }
    if lp64 {
        def("__LP64__", "1");
        def("_LP64", "1");
    }
    def("__ORDER_LITTLE_ENDIAN__", "1234");
    def("__ORDER_BIG_ENDIAN__", "4321");
    def("__ORDER_PDP_ENDIAN__", "3412");
    def("__BYTE_ORDER__", "__ORDER_LITTLE_ENDIAN__");
    def("__FLOAT_WORD_ORDER__", "__ORDER_LITTLE_ENDIAN__");
    def("__LITTLE_ENDIAN__", "1");
    def(
        "__USER_LABEL_PREFIX__",
        if target.os == Os::MacOs { "_" } else { "" },
    );
    def("__REGISTER_PREFIX__", "");
    if !char_signed {
        def("__CHAR_UNSIGNED__", "1");
    }

    let long = if lp64 { 8 } else { 4 };
    def("__CHAR_BIT__", "8");
    for (name, size) in [
        ("SHORT", 2),
        ("INT", 4),
        ("LONG", long),
        ("LONG_LONG", 8),
        ("POINTER", 8),
        ("FLOAT", 4),
        ("DOUBLE", 8),
        ("LONG_DOUBLE", long_double_bytes),
        ("SIZE_T", 8),
        ("PTRDIFF_T", 8),
        ("WCHAR_T", if windows { 2 } else { 4 }),
        ("WINT_T", if windows { 2 } else { 4 }),
        // `__int128` exists on every target here.
        ("INT128", 16),
    ] {
        def(&format!("__SIZEOF_{name}__"), &size.to_string());
    }

    // The C type, its literal suffix and its maximum for each typedef-like macro.
    struct Int {
        ty: &'static str,
        suffix: &'static str,
        max: &'static str,
    }
    let i8_ = Int {
        ty: "signed char",
        suffix: "",
        max: "0x7f",
    };
    let u8_ = Int {
        ty: "unsigned char",
        suffix: "",
        max: "0xff",
    };
    let i16_ = Int {
        ty: "short",
        suffix: "",
        max: "0x7fff",
    };
    let u16_ = Int {
        ty: "unsigned short",
        suffix: "",
        max: "0xffff",
    };
    let i32_ = Int {
        ty: "int",
        suffix: "",
        max: "0x7fffffff",
    };
    let u32_ = Int {
        ty: "unsigned int",
        suffix: "U",
        max: "0xffffffffU",
    };
    let (i64_, u64_) = if lp64 {
        (
            Int {
                ty: "long",
                suffix: "L",
                max: "0x7fffffffffffffffL",
            },
            Int {
                ty: "unsigned long",
                suffix: "UL",
                max: "0xffffffffffffffffUL",
            },
        )
    } else {
        (
            Int {
                ty: "long long",
                suffix: "LL",
                max: "0x7fffffffffffffffLL",
            },
            Int {
                ty: "unsigned long long",
                suffix: "ULL",
                max: "0xffffffffffffffffULL",
            },
        )
    };
    // macOS uses long long for the 64-bit exact-width types.
    let (i64x, u64x) = if target.os == Os::MacOs {
        (
            Int {
                ty: "long long",
                suffix: "LL",
                max: "0x7fffffffffffffffLL",
            },
            Int {
                ty: "unsigned long long",
                suffix: "ULL",
                max: "0xffffffffffffffffULL",
            },
        )
    } else {
        (Int { ..i64_ }, Int { ..u64_ })
    };

    def("__SCHAR_MAX__", "0x7f");
    def("__SHRT_MAX__", "0x7fff");
    def("__INT_MAX__", "0x7fffffff");
    def(
        "__LONG_MAX__",
        if lp64 {
            "0x7fffffffffffffffL"
        } else {
            "0x7fffffffL"
        },
    );
    def("__LONG_LONG_MAX__", "0x7fffffffffffffffLL");
    def("__SIG_ATOMIC_MAX__", "0x7fffffff");
    def("__SIG_ATOMIC_TYPE__", "int");

    let mut typed = |prefix: &str, int: &Int, with_c: bool| {
        def(&format!("__{prefix}_TYPE__"), int.ty);
        def(&format!("__{prefix}_MAX__"), int.max);
        if with_c {
            if int.suffix.is_empty() {
                def(&format!("__{prefix}_C(c)"), "c");
            } else {
                def(&format!("__{prefix}_C(c)"), &format!("c ## {}", int.suffix));
            }
        }
    };
    typed("INT8", &i8_, true);
    typed("INT16", &i16_, true);
    typed("INT32", &i32_, true);
    typed("INT64", &i64x, true);
    typed("UINT8", &u8_, true);
    typed("UINT16", &u16_, true);
    typed("UINT32", &u32_, true);
    typed("UINT64", &u64x, true);
    typed("INT_LEAST8", &i8_, false);
    typed("INT_LEAST16", &i16_, false);
    typed("INT_LEAST32", &i32_, false);
    typed("INT_LEAST64", &i64x, false);
    typed("UINT_LEAST8", &u8_, false);
    typed("UINT_LEAST16", &u16_, false);
    typed("UINT_LEAST32", &u32_, false);
    typed("UINT_LEAST64", &u64x, false);
    // glibc makes the 16/32-bit fast types word-sized on 64-bit Linux; elsewhere they are exact.
    let linux = target.os == Os::Linux;
    typed("INT_FAST8", &i8_, false);
    typed("INT_FAST16", if linux { &i64_ } else { &i16_ }, false);
    typed("INT_FAST32", if linux { &i64_ } else { &i32_ }, false);
    typed("INT_FAST64", &i64x, false);
    typed("UINT_FAST8", &u8_, false);
    typed("UINT_FAST16", if linux { &u64_ } else { &u16_ }, false);
    typed("UINT_FAST32", if linux { &u64_ } else { &u32_ }, false);
    typed("UINT_FAST64", &u64x, false);
    typed("INTPTR", &i64_, false);
    typed("UINTPTR", &u64_, false);
    typed("INTMAX", &i64_, true);
    typed("UINTMAX", &u64_, true);
    typed("SIZE", &u64_, false);
    typed("PTRDIFF", &i64_, false);
    if windows {
        def("__WCHAR_TYPE__", "unsigned short");
        def("__WCHAR_MAX__", "0xffff");
        def("__WCHAR_MIN__", "0");
        def("__WINT_TYPE__", "unsigned short");
        def("__WINT_MAX__", "0xffff");
        def("__WINT_MIN__", "0");
    } else {
        def("__WCHAR_TYPE__", "int");
        def("__WCHAR_MAX__", "0x7fffffff");
        def("__WCHAR_MIN__", "(-__WCHAR_MAX__ - 1)");
        def(
            "__WINT_TYPE__",
            if target.os == Os::MacOs {
                "int"
            } else {
                "unsigned int"
            },
        );
        def(
            "__WINT_MAX__",
            if target.os == Os::MacOs {
                "0x7fffffff"
            } else {
                "0xffffffffU"
            },
        );
        def(
            "__WINT_MIN__",
            if target.os == Os::MacOs {
                "(-__WINT_MAX__ - 1)"
            } else {
                "0U"
            },
        );
    }
    def("__CHAR16_TYPE__", "unsigned short");
    def("__CHAR32_TYPE__", "unsigned int");

    def("__FLT_RADIX__", "2");
    def("__FLT_EVAL_METHOD__", "0");
    def("__FLT_MANT_DIG__", "24");
    def("__FLT_DIG__", "6");
    def("__FLT_DECIMAL_DIG__", "9");
    def("__FLT_MIN_EXP__", "(-125)");
    def("__FLT_MIN_10_EXP__", "(-37)");
    def("__FLT_MAX_EXP__", "128");
    def("__FLT_MAX_10_EXP__", "38");
    def("__FLT_MAX__", "3.40282346638528859811704183484516925e+38F");
    def("__FLT_MIN__", "1.17549435082228750796873653722224568e-38F");
    def(
        "__FLT_EPSILON__",
        "1.19209289550781250000000000000000000e-7F",
    );
    def(
        "__FLT_DENORM_MIN__",
        "1.40129846432481707092372958328991613e-45F",
    );
    def("__FLT_HAS_DENORM__", "1");
    def("__FLT_HAS_INFINITY__", "1");
    def("__FLT_HAS_QUIET_NAN__", "1");
    let mut double_like = |prefix: &str, suffix: &str| {
        def(&format!("__{prefix}_MANT_DIG__"), "53");
        def(&format!("__{prefix}_DIG__"), "15");
        def(&format!("__{prefix}_DECIMAL_DIG__"), "17");
        def(&format!("__{prefix}_MIN_EXP__"), "(-1021)");
        def(&format!("__{prefix}_MIN_10_EXP__"), "(-307)");
        def(&format!("__{prefix}_MAX_EXP__"), "1024");
        def(&format!("__{prefix}_MAX_10_EXP__"), "308");
        def(
            &format!("__{prefix}_MAX__"),
            &format!("1.79769313486231570814527423731704357e+308{suffix}"),
        );
        def(
            &format!("__{prefix}_MIN__"),
            &format!("2.22507385850720138309023271733240406e-308{suffix}"),
        );
        def(
            &format!("__{prefix}_EPSILON__"),
            &format!("2.22044604925031308084726333618164062e-16{suffix}"),
        );
        def(
            &format!("__{prefix}_DENORM_MIN__"),
            &format!("4.94065645841246544176568792868221372e-324{suffix}"),
        );
        def(&format!("__{prefix}_HAS_DENORM__"), "1");
        def(&format!("__{prefix}_HAS_INFINITY__"), "1");
        def(&format!("__{prefix}_HAS_QUIET_NAN__"), "1");
    };
    double_like("DBL", "");
    if target.long_double_is_x87() {
        def("__LDBL_MANT_DIG__", "64");
        def("__LDBL_DIG__", "18");
        def("__LDBL_DECIMAL_DIG__", "21");
        def("__LDBL_MIN_EXP__", "(-16381)");
        def("__LDBL_MIN_10_EXP__", "(-4931)");
        def("__LDBL_MAX_EXP__", "16384");
        def("__LDBL_MAX_10_EXP__", "4932");
        def(
            "__LDBL_MAX__",
            "1.18973149535723176502126385303097021e+4932L",
        );
        def(
            "__LDBL_NORM_MAX__",
            "1.18973149535723176502126385303097021e+4932L",
        );
        def(
            "__LDBL_MIN__",
            "3.36210314311209350626267781732175260e-4932L",
        );
        def(
            "__LDBL_EPSILON__",
            "1.08420217248550443400745280086994171e-19L",
        );
        def(
            "__LDBL_DENORM_MIN__",
            "3.64519953188247460252840593361941982e-4951L",
        );
        def("__LDBL_HAS_DENORM__", "1");
        def("__LDBL_HAS_INFINITY__", "1");
        def("__LDBL_HAS_QUIET_NAN__", "1");
        def("__DECIMAL_DIG__", "21");
    } else {
        // Where long double is wider than double and not the x87 format, arithmetic on it is
        // not implemented: it is described with double's characteristics so that the
        // constants are at least representable.
        double_like("LDBL", "");
        def("__DECIMAL_DIG__", "17");
    }
    out
}
