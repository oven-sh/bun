#pragma once

// What is being compiled for, and with which features. A name that nothing defines reads as off.

#define OS(name) (defined WTF_OS_##name && WTF_OS_##name)
#define CPU(name) (defined WTF_CPU_##name && WTF_CPU_##name)
#define PLATFORM(name) (defined WTF_PLATFORM_##name && WTF_PLATFORM_##name)
#define ENABLE(name) (defined ENABLE_##name && ENABLE_##name)
#define USE(name) (defined USE_##name && USE_##name)
#define HAVE(name) (defined HAVE_##name && HAVE_##name)

#include "engine/support/Compiler.h"

#if defined(_WIN32)
#define WTF_OS_WINDOWS 1
#elif defined(__APPLE__)
#define WTF_OS_DARWIN 1
#define WTF_OS_MACOS 1
#elif defined(__FreeBSD__)
#define WTF_OS_FREEBSD 1
#elif defined(__linux__)
#define WTF_OS_LINUX 1
#if defined(__ANDROID__)
#define WTF_OS_ANDROID 1
#endif
#else
#error "Unsupported operating system"
#endif

#if defined(__x86_64__) || defined(_M_X64)
#define WTF_CPU_X86_64 1
#elif defined(__aarch64__) || defined(_M_ARM64)
#define WTF_CPU_ARM64 1
#else
#error "Unsupported processor"
#endif
#define WTF_CPU_ADDRESS64 1

#ifndef ASSERT_ENABLED
#ifdef NDEBUG
#define ASSERT_ENABLED 0
#else
#define ASSERT_ENABLED 1
#endif
#endif

#define ENABLE_EXCEPTION_SCOPE_VERIFICATION (ASSERT_ENABLED || ASAN_ENABLED)
#define ENABLE_RESOURCE_USAGE 1
#define ENABLE_SECURITY_ASSERTIONS (ASSERT_ENABLED || ASAN_ENABLED)
#ifndef BUN_DISABLE_WEBASSEMBLY
#define ENABLE_WEBASSEMBLY 1
#endif

#define USE_BUN_JSC_ADDITIONS 1
#define USE_MIMALLOC !ASAN_ENABLED

#if OS(WINDOWS) && CPU(X86_64)
#define SYSV_ABI __attribute__((sysv_abi))
#else
#define SYSV_ABI
#endif
