#pragma once

#define COMPILER(name) (defined WTF_COMPILER_##name && WTF_COMPILER_##name)

#ifndef __clang__
#error "Unsupported compiler"
#endif
#ifdef _MSC_VER
#define WTF_COMPILER_MSVC 1
#endif

#if __has_feature(address_sanitizer)
#define ASAN_ENABLED 1
#define SUPPRESS_ASAN __attribute__((no_sanitize_address))
#else
#define ASAN_ENABLED 0
#define SUPPRESS_ASAN
#endif

#ifdef NDEBUG
#define ALWAYS_INLINE inline __attribute__((always_inline))
#define ALWAYS_INLINE_LAMBDA __attribute__((always_inline))
#else
#define ALWAYS_INLINE inline
#define ALWAYS_INLINE_LAMBDA
#endif
#define NEVER_INLINE __attribute__((noinline))
#define NOESCAPE __attribute__((noescape))
#define RETURNS_NONNULL __attribute__((returns_nonnull))
#define TRIVIAL_ABI __attribute__((trivial_abi))

#define UNUSED_PARAM(variable) (void)variable
#define UNUSED_VARIABLE(variable) (void)variable

#define WTF_PRAGMA(text) _Pragma(#text)
#define WTF_IGNORE_WARNING(flag) WTF_PRAGMA(clang diagnostic ignored flag)
#define IGNORE_WARNINGS_BEGIN(warning) WTF_PRAGMA(clang diagnostic push) WTF_IGNORE_WARNING("-W" warning)
#define IGNORE_WARNINGS_END WTF_PRAGMA(clang diagnostic pop)

#define SUPPRESS_UNCOUNTED_LOCAL

#ifdef __cplusplus
#define LIFETIME_BOUND [[clang::lifetimebound]]
#endif
