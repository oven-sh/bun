#if defined(WIN32)

#include <cstdint>
#include <algorithm>
#include <sys/stat.h>
#include <uv.h>
#include <fcntl.h>
#include <windows.h>
#include <string.h>
#include <cstdlib>

#undef _environ
#undef environ

// Some libraries need these symbols. Windows makes it
extern "C" char** environ = nullptr;
extern "C" char** _environ = nullptr;

extern "C" int strncasecmp(const char* s1, const char* s2, size_t n)
{
    return _strnicmp(s1, s2, n);
}

extern "C" int fstat64(
    _In_ int _FileHandle,
    _Out_ struct _stat64* _Stat)
{

    return _fstat64(_FileHandle, _Stat);
}

extern "C" int stat64(
    _In_z_ char const* _FileName,
    _Out_ struct _stat64* _Stat)
{
    return _stat64(_FileName, _Stat);
}

extern "C" int kill(int pid, int sig)
{
    return uv_kill(pid, sig);
}

#endif

#if !defined(WIN32)
#ifndef UNLIKELY
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif
#endif

// if linux
#if defined(__linux__)
#include <features.h>
#ifdef __GNU_LIBRARY__

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <fcntl.h>
#include <dlfcn.h>
#include <stdarg.h>
#include <errno.h>
#include <math.h>
#include <mutex>
#include <semaphore.h>
#include <stdio.h>
#include <signal.h>
#include <sys/random.h>
#include <dlfcn.h>

#ifndef _STAT_VER
#if defined(__aarch64__)
#define _STAT_VER 0
#elif defined(__x86_64__)
#define _STAT_VER 1
#else
#define _STAT_VER 3
#endif
#endif

#if defined(__x86_64__)
__asm__(".symver exp,exp@GLIBC_2.2.5");
__asm__(".symver exp2,exp2@GLIBC_2.2.5");
__asm__(".symver expf,expf@GLIBC_2.2.5");
__asm__(".symver log,log@GLIBC_2.2.5");
__asm__(".symver log2,log2@GLIBC_2.2.5");
__asm__(".symver log2f,log2f@GLIBC_2.2.5");
__asm__(".symver logf,logf@GLIBC_2.2.5");
__asm__(".symver pow,pow@GLIBC_2.2.5");
__asm__(".symver powf,powf@GLIBC_2.2.5");
#elif defined(__aarch64__)
__asm__(".symver expf,expf@GLIBC_2.17");
__asm__(".symver exp,exp@GLIBC_2.17");
__asm__(".symver exp2,exp2@GLIBC_2.17");
__asm__(".symver log,log@GLIBC_2.17");
__asm__(".symver log2,log2@GLIBC_2.17");
__asm__(".symver log2f,log2f@GLIBC_2.17");
__asm__(".symver logf,logf@GLIBC_2.17");
__asm__(".symver pow,pow@GLIBC_2.17");
__asm__(".symver powf,powf@GLIBC_2.17");
#endif

#if defined(__x86_64__) || defined(__aarch64__)
#define BUN_WRAP_GLIBC_SYMBOL(symbol) __wrap_##symbol
#else
#define BUN_WRAP_GLIBC_SYMBOL(symbol) symbol
#endif

extern "C" {

double BUN_WRAP_GLIBC_SYMBOL(exp)(double);
double BUN_WRAP_GLIBC_SYMBOL(exp2)(double);
float BUN_WRAP_GLIBC_SYMBOL(expf)(float);
float BUN_WRAP_GLIBC_SYMBOL(log2f)(float);
float BUN_WRAP_GLIBC_SYMBOL(logf)(float);
float BUN_WRAP_GLIBC_SYMBOL(powf)(float, float);
double BUN_WRAP_GLIBC_SYMBOL(pow)(double, double);
double BUN_WRAP_GLIBC_SYMBOL(log)(double);
double BUN_WRAP_GLIBC_SYMBOL(log2)(double);
int BUN_WRAP_GLIBC_SYMBOL(fcntl64)(int, int, ...);

float __wrap_expf(float x) { return expf(x); }
float __wrap_powf(float x, float y) { return powf(x, y); }
float __wrap_logf(float x) { return logf(x); }
float __wrap_log2f(float x) { return log2f(x); }
double __wrap_exp(double x) { return exp(x); }
double __wrap_exp2(double x) { return exp2(x); }
double __wrap_pow(double x, double y) { return pow(x, y); }
double __wrap_log(double x) { return log(x); }
double __wrap_log2(double x) { return log2(x); }

} // extern "C"

typedef int (*fcntl64_func)(int fd, int cmd, ...);

enum arg_type {
    NO_ARG,
    INT_ARG,
    PTR_ARG
};

static enum arg_type get_arg_type(int cmd)
{
    switch (cmd) {
    // Commands that take no argument
    case F_GETFD:
    case F_GETFL:
    case F_GETOWN:
    case F_GETSIG:
    case F_GETLEASE:
    case F_GETPIPE_SZ:
#ifdef F_GET_SEALS
    case F_GET_SEALS:
#endif
        return NO_ARG;

    // Commands that take an integer argument
    case F_DUPFD:
    case F_DUPFD_CLOEXEC:
    case F_SETFD:
    case F_SETFL:
    case F_SETOWN:
    case F_SETSIG:
    case F_SETLEASE:
    case F_NOTIFY:
    case F_SETPIPE_SZ:
#ifdef F_ADD_SEALS
    case F_ADD_SEALS:
#endif
        return INT_ARG;

    // Commands that take a pointer argument
    case F_GETLK:
    case F_SETLK:
    case F_SETLKW:
    case F_GETOWN_EX:
    case F_SETOWN_EX:
        return PTR_ARG;

    default:
        return PTR_ARG; // Default to pointer for unknown commands
    }
}

extern "C" int __wrap_fcntl64(int fd, int cmd, ...)
{
    va_list ap;
    enum arg_type type = get_arg_type(cmd);

    static fcntl64_func real_fcntl64;
    static std::once_flag real_fcntl64_initialized;
    std::call_once(real_fcntl64_initialized, []() {
        real_fcntl64 = (fcntl64_func)dlsym(RTLD_NEXT, "fcntl64");
        if (!real_fcntl64) {
            real_fcntl64 = (fcntl64_func)dlsym(RTLD_NEXT, "fcntl");
        }
    });

    switch (type) {
    case NO_ARG:
        return real_fcntl64(fd, cmd);

    case INT_ARG: {
        va_start(ap, cmd);
        int arg = va_arg(ap, int);
        va_end(ap);
        return real_fcntl64(fd, cmd, arg);
    }

    case PTR_ARG: {
        va_start(ap, cmd);
        void* arg = va_arg(ap, void*);
        va_end(ap);
        return real_fcntl64(fd, cmd, arg);
    }

    default:
        va_end(ap);
        errno = EINVAL;
        return -1;
    }
}

extern "C" __attribute__((used)) char _libc_single_threaded = 0;
extern "C" __attribute__((used)) char __libc_single_threaded = 0;

#endif // glibc

// musl

#endif // linux

// macOS
#if defined(__APPLE__)

#include <version>
#include <dlfcn.h>
#include <cstdint>
#include <cstdarg>
#include <cstdio>
#include "headers.h"

// Check if the stdlib declaration already has noexcept by looking at the header
#ifdef _LIBCPP___VERBOSE_ABORT
#if __has_include(<__verbose_abort>)
#include <__verbose_abort>
#endif
#endif

#ifdef _LIBCPP_VERBOSE_ABORT_NOEXCEPT
// Workaround for this error:
// workaround-missing-symbols.cpp:245:11: error: '__libcpp_verbose_abort' is missing exception specification 'noexcept'
// 2025-07-10 15:59:47 PDT
//   245 | void std::__libcpp_verbose_abort(char const* format, ...)
// 2025-07-10 15:59:47 PDT
//       |           ^
// 2025-07-10 15:59:47 PDT
//       |                                                           noexcept
// 2025-07-10 15:59:47 PDT
// /opt/homebrew/Cellar/llvm/20.1.7/bin/../include/c++/v1/__verbose_abort:30:28: note: previous declaration is here
// 2025-07-10 15:59:47 PDT
//    30 |     __printf__, 1, 2) void __libcpp_verbose_abort(const char* __format, ...) _LIBCPP_VERBOSE_ABORT_NOEXCEPT;
// 2025-07-10 15:59:47 PDT
//       |                            ^
// 2025-07-10 15:59:47 PDT
// 1 error generated.
// 2025-07-10 15:59:47 PDT
// [515/540] Building CXX
#define BUN_VERBOSE_ABORT_NOEXCEPT _LIBCPP_VERBOSE_ABORT_NOEXCEPT
#else
#define BUN_VERBOSE_ABORT_NOEXCEPT
#endif

// Provide our implementation
void std::__libcpp_verbose_abort(char const* format, ...) BUN_VERBOSE_ABORT_NOEXCEPT
{
    va_list list;
    va_start(list, format);
    char buffer[1024];
    size_t len = vsnprintf(buffer, sizeof(buffer), format, list);
    va_end(list);

    Bun__panic(buffer, len);
}

#undef BUN_VERBOSE_ABORT_NOEXCEPT

#endif

#ifndef U_SHOW_CPLUSPLUS_API
#define U_SHOW_CPLUSPLUS_API 0
#endif

#include <unicode/uchar.h>

extern "C" bool icu_hasBinaryProperty(UChar32 cp, unsigned int prop)
{
    return u_hasBinaryProperty(cp, static_cast<UProperty>(prop));
}

extern "C" __attribute__((weak)) void mi_thread_set_in_threadpool() {}
