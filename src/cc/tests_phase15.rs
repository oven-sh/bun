//! Phase 15: Microsoft C, as Visual Studio's, the Universal C Runtime's and the Windows SDK's
//! headers are written in it. Everything here is declared inline: no SDK is needed.

use std::collections::BTreeMap;

use crate::tests::{WINDOWS_X64, checked_for, has};
use crate::{
    Arch, CompileOptions, FileProvider, Os, Target, compile_with, compile_with_warnings,
    disassemble, predefined_macros, predefined_macros_as_gnu,
};

const WINDOWS_ARM64: Target = Target {
    arch: Arch::Aarch64,
    os: Os::Windows,
};

struct MemoryFiles(BTreeMap<&'static str, &'static str>);

impl FileProvider for MemoryFiles {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.get(path).map(|text| text.as_bytes().to_vec())
    }
}

fn listing(src: &str, target: Target) -> String {
    disassemble(&checked_for(src, target)).expect("valid")
}

fn count(text: &str, needle: &str) -> usize {
    (0..text.len())
        .filter(|&i| text[i..].starts_with(needle))
        .count()
}

/// (What a Windows target predefines is fixtures/basics/microsoft-c-compile-time-rules; nothing in Bun claims
/// GNU C for one, and no test machine is Windows on arm64.)
#[test]
fn a_windows_target_is_microsoft_c_unless_gnu_c_is_claimed() {
    assert!(has(
        &predefined_macros(WINDOWS_ARM64),
        "#define _M_ARM64 1\n"
    ));
    let gnu = predefined_macros_as_gnu(WINDOWS_X64, (9, 0, 0));
    assert!(has(&gnu, "#define __GNUC__ 9\n") && has(&gnu, "#define _WIN32 1\n"));
    assert!(!has(&gnu, "_MSC_VER") && has(&gnu, "#define __STDC__ 1\n"));
}

/// (Nothing a program can see shows a warning.)
#[test]
fn an_unknown_declspec_is_a_warning() {
    let warnings = compile_with_warnings(
        b"__declspec(something_new(1, 2)) int f(void);",
        "t.c",
        &CompileOptions::new(WINDOWS_X64),
    )
    .expect("an unknown __declspec is a warning")
    .warnings;
    assert!(
        warnings
            .iter()
            .any(|w| has(&w.message, "unknown attribute 'something_new'")),
        "{}",
        warnings.len()
    );
}

/// The libraries a module asks for, once each, in order: the loader reads the list, a program cannot.
#[test]
fn pragma_comment_lib_names_are_kept_as_written() {
    let output = compile_with_warnings(
        b"#pragma comment(lib, \"user32.lib\")\n#pragma comment(lib, \"ws2_32\")\n#pragma comment(lib, \"user32.lib\")\nint f(void);",
        "t.c",
        &CompileOptions::new(WINDOWS_X64),
    )
    .expect("compiles");
    assert_eq!(output.libraries, ["user32.lib", "ws2_32"]);
}

/// (x64 is fixtures/basics/microsoft-c-without-headers; no test machine is Windows on arm64.)
#[test]
fn va_start_on_windows_arm64() {
    // The ARM64 form names the last parameter four more ways.
    let arm = listing(
        "typedef char *va_list; void __va_start(va_list *, ...);
         int first(int n, ...) { va_list ap; __va_start(&ap, &n, 8, __alignof(n), &n); return *(int *)ap; }",
        WINDOWS_ARM64,
    );
    assert!(has(&arm, "VaStart"), "{arm}");
}

#[test]
fn intrinsics_are_the_compilers_own() {
    let text = listing(
        "unsigned char _BitScanForward(unsigned long *, unsigned long);
         unsigned char _BitScanReverse64(unsigned long *, unsigned __int64);
         long _InterlockedIncrement(long volatile *);
         long _InterlockedCompareExchange(long volatile *, long, long);
         __int64 _InterlockedExchangeAdd64(__int64 volatile *, __int64);
         void *_InterlockedCompareExchangePointer(void *volatile *, void *, void *);
         unsigned __int64 __readgsqword(unsigned long);
         unsigned __int64 _umul128(unsigned __int64, unsigned __int64, unsigned __int64 *);
         unsigned __int64 __rdtsc(void);
         unsigned long _byteswap_ulong(unsigned long);
         void __cpuid(int[4], int);
         void _ReadWriteBarrier(void);
         void __stosb(unsigned char *, unsigned char, unsigned __int64);
         #pragma intrinsic(_BitScanForward, _InterlockedIncrement)
         static long counter; static void *slot;
         unsigned __int64 all(unsigned long m, unsigned __int64 q, unsigned char *buffer) {
             unsigned long i = 0, j = 0; unsigned __int64 high; int info[4];
             _BitScanForward(&i, m); _BitScanReverse64(&j, q);
             _InterlockedIncrement(&counter); _InterlockedCompareExchange(&counter, 1, 2);
             _InterlockedCompareExchangePointer(&slot, buffer, 0);
             __cpuid(info, 0); _ReadWriteBarrier(); __stosb(buffer, 1, 4);
             return i + j + _umul128(q, q, &high) + high + __rdtsc() + _byteswap_ulong(m) + __readgsqword(0x30) + (unsigned)info[0];
         }",
        WINDOWS_X64,
    );
    assert_eq!(count(&text, "\nextern "), 0, "{text}");
    // `mov rax, gs:[rcx]` and `rdtsc`.
    assert!(
        has(&text, "[65 48 8b 01]") && has(&text, "[0f 31]"),
        "{text}"
    );
    assert!(
        has(&text, "AtomicRmw") && has(&text, "AtomicCas") && has(&text, "CpuId"),
        "{text}"
    );
    // A program's own definition is the program's.
    let own = listing(
        "unsigned int _rotl(unsigned int v, int n) { return v + (unsigned)n; }
         unsigned int uses(unsigned int v) { return _rotl(v, 3); }",
        WINDOWS_X64,
    );
    assert!(has(&own, "Call") && !has(&own, "RotL"), "{own}");
    let theirs = listing(
        "unsigned int _rotl(unsigned int, int); unsigned int uses(unsigned int v) { return _rotl(v, 3); }",
        WINDOWS_X64,
    );
    assert!(
        has(&theirs, "RotL") && count(&theirs, "\nextern ") == 0,
        "{theirs}"
    );
    // <intrin.h> declares them all, for both architectures.
    for target in [WINDOWS_X64, WINDOWS_ARM64] {
        checked_for(
            "#include <intrin.h>
             long f(long volatile *p, unsigned long *i, unsigned __int64 q) { return _InterlockedExchangeAdd_acq(p, 2) + _InterlockedOr8((char volatile *)p, 1) + _BitScanForward64(i, q) + (long)__popcnt64(q) + (long)__shiftleft128(q, q, 3); }",
            target,
        );
    }
    checked_for(
        "#include <intrin.h>
         unsigned f(unsigned long x) { __dmb(_ARM64_BARRIER_ISH); return _CountLeadingZeros(x) + __load_acquire32((unsigned __int32 *)&x); }",
        WINDOWS_ARM64,
    );
}

#[test]
fn setjmp_gets_the_frame_argument_its_prototype_lacks() {
    let text = listing(
        "typedef struct { unsigned __int64 part[2]; } jmp_buf[16];
         #define setjmp _setjmp
         int __cdecl setjmp(jmp_buf);
         __declspec(noreturn) void __cdecl longjmp(jmp_buf, int);
         static jmp_buf env;
         int f(void) { if (setjmp(env)) return 1; longjmp(env, 2); }",
        WINDOWS_X64,
    );
    // Two arguments, the second one null.
    assert!(has(&text, "extern 0: _setjmp"), "{text}");
    assert!(
        has(&text, "(i64, i64) -> i32") && has(&text, "CallIndirect"),
        "{text}"
    );
    assert!(has(&text, "ConstI64 0") && has(&text, "(v1, v2)"), "{text}");
    // The MinGW spelling, which passes the frame itself, is left as written.
    let mingw = listing(
        "typedef int jmp_buf[64]; int _setjmp(jmp_buf, void *);
         static jmp_buf env; int f(void) { return _setjmp(env, __builtin_frame_address(0)); }",
        WINDOWS_X64,
    );
    assert!(
        has(&mingw, "CallExtern 0 <_setjmp>") && has(&mingw, "FrameAddress"),
        "{mingw}"
    );
}

#[test]
fn microsofts_headers_come_before_the_compilers_where_it_has_both() {
    let files = MemoryFiles(
        [
            (
                "/vs/stdint.h",
                "#define THEIR_STDINT 1\ntypedef long long int64_t; typedef signed char int_least8_t, int_fast8_t; typedef unsigned char uint_least8_t, uint_fast8_t;
                 typedef short int_least16_t, int_fast16_t; typedef unsigned short uint_least16_t, uint_fast16_t; typedef int int_least32_t, int_fast32_t;
                 typedef unsigned uint_least32_t, uint_fast32_t; typedef long long int_least64_t, int_fast64_t, intmax_t, intptr_t;
                 typedef unsigned long long uint_least64_t, uint_fast64_t, uintmax_t, uintptr_t;\n",
            ),
            (
                "/vs/stddef.h",
                "#define THEIR_STDDEF 1\ntypedef unsigned long long size_t; typedef long long ptrdiff_t; typedef unsigned short wchar_t;\n",
            ),
            ("/vs/stdatomic.h", "#error theirs is for C++\n"),
        ]
        .into_iter()
        .collect(),
    );
    let source =
        b"#include <stdint.h>\n#include <stddef.h>\n#include <stdatomic.h>\n#include <stdalign.h>\n
        #if !defined(THEIR_STDINT) || !defined(THEIR_STDDEF)\n#error ours\n#endif\n
        max_align_t most; int64_t wide; size_t size; atomic_int flag; alignas(16) char buffer[3];";
    let options = CompileOptions {
        file_provider: &files,
        system_include_dirs: vec!["/vs".to_string()],
        ..CompileOptions::new(WINDOWS_X64)
    };
    compile_with(source, "t.c", &options).expect("theirs first, ours for the rest");
    // Claiming GNU C, or on any other system, the compiler's own come first as they always did.
    let gnu = CompileOptions {
        gnu_version: Some((9, 0, 0)),
        file_provider: &files,
        system_include_dirs: vec!["/vs".to_string()],
        ..CompileOptions::new(WINDOWS_X64)
    };
    let e = compile_with(source, "t.c", &gnu).expect_err("ours first");
    assert!(has(&e[0].message, "ours"), "{}", e[0].message);
}
