

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
__asm__(".symver cosf,cosf@GLIBC_2.2.5");
__asm__(".symver exp,exp@GLIBC_2.2.5");
__asm__(".symver expf,expf@GLIBC_2.2.5");
__asm__(".symver fcntl,fcntl@GLIBC_2.2.5");
__asm__(".symver fmod,fmod@GLIBC_2.2.5");
__asm__(".symver fmodf,fmodf@GLIBC_2.2.5");
__asm__(".symver log,log@GLIBC_2.2.5");
__asm__(".symver log10f,log10f@GLIBC_2.2.5");
__asm__(".symver log2,log2@GLIBC_2.2.5");
__asm__(".symver log2f,log2f@GLIBC_2.2.5");
__asm__(".symver logf,logf@GLIBC_2.2.5");
__asm__(".symver pow,pow@GLIBC_2.2.5");
__asm__(".symver powf,powf@GLIBC_2.2.5");
__asm__(".symver sincosf,sincosf@GLIBC_2.2.5");
__asm__(".symver sinf,sinf@GLIBC_2.2.5");
__asm__(".symver tanf,tanf@GLIBC_2.2.5");
#elif defined(__aarch64__)
__asm__(".symver cosf,cosf@GLIBC_2.17");
__asm__(".symver exp,exp@GLIBC_2.17");
__asm__(".symver expf,expf@GLIBC_2.17");
__asm__(".symver fmod,fmod@GLIBC_2.17");
__asm__(".symver fmodf,fmodf@GLIBC_2.17");
__asm__(".symver log,log@GLIBC_2.17");
__asm__(".symver log10f,log10f@GLIBC_2.17");
__asm__(".symver log2,log2@GLIBC_2.17");
__asm__(".symver log2f,log2f@GLIBC_2.17");
__asm__(".symver logf,logf@GLIBC_2.17");
__asm__(".symver pow,pow@GLIBC_2.17");
__asm__(".symver powf,powf@GLIBC_2.17");
__asm__(".symver sincosf,sincosf@GLIBC_2.17");
__asm__(".symver sinf,sinf@GLIBC_2.17");
__asm__(".symver tanf,tanf@GLIBC_2.17");
#endif

#if defined(__x86_64__) || defined(__aarch64__)
#define BUN_WRAP_GLIBC_SYMBOL(symbol) __wrap_##symbol
#else
#define BUN_WRAP_GLIBC_SYMBOL(symbol) symbol
#endif

extern "C" {
double BUN_WRAP_GLIBC_SYMBOL(exp)(double);
double BUN_WRAP_GLIBC_SYMBOL(fmod)(double, double);
double BUN_WRAP_GLIBC_SYMBOL(log)(double);
double BUN_WRAP_GLIBC_SYMBOL(log2)(double);
double BUN_WRAP_GLIBC_SYMBOL(pow)(double, double);
float BUN_WRAP_GLIBC_SYMBOL(cosf)(float);
float BUN_WRAP_GLIBC_SYMBOL(expf)(float);
float BUN_WRAP_GLIBC_SYMBOL(fmodf)(float, float);
float BUN_WRAP_GLIBC_SYMBOL(log10f)(float);
float BUN_WRAP_GLIBC_SYMBOL(log2f)(float);
float BUN_WRAP_GLIBC_SYMBOL(logf)(float);
float BUN_WRAP_GLIBC_SYMBOL(sinf)(float);
float BUN_WRAP_GLIBC_SYMBOL(tanf)(float);
int BUN_WRAP_GLIBC_SYMBOL(fcntl)(int, int, ...);
int BUN_WRAP_GLIBC_SYMBOL(fcntl64)(int, int, ...);
void BUN_WRAP_GLIBC_SYMBOL(sincosf)(float, float*, float*);
}

extern "C" {

#if defined(__x86_64__) || defined(__aarch64__)

int __wrap_fcntl(int fd, int cmd, ...)
{
    va_list args;
    va_start(args, cmd);
    void* arg = va_arg(args, void*);
    va_end(args);
    return fcntl(fd, cmd, arg);
}

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

#endif

#if defined(__x86_64__)

#ifndef _MKNOD_VER
#define _MKNOD_VER 1
#endif

extern "C" int __lxstat(int ver, const char* filename, struct stat* stat);
extern "C" int __wrap_lstat(const char* filename, struct stat* stat)
{
    return __lxstat(_STAT_VER, filename, stat);
}

extern "C" int __xstat(int ver, const char* filename, struct stat* stat);
extern "C" int __wrap_stat(const char* filename, struct stat* stat)
{
    return __xstat(_STAT_VER, filename, stat);
}

extern "C" int __fxstat(int ver, int fd, struct stat* stat);
extern "C" int __wrap_fstat(int fd, struct stat* stat)
{
    return __fxstat(_STAT_VER, fd, stat);
}

extern "C" int __fxstatat(int ver, int dirfd, const char* path, struct stat* stat, int flags);
extern "C" int __wrap_fstatat(int dirfd, const char* path, struct stat* stat, int flags)
{
    return __fxstatat(_STAT_VER, dirfd, path, stat, flags);
}

extern "C" int __lxstat64(int ver, const char* filename, struct stat64* stat);
extern "C" int __wrap_lstat64(const char* filename, struct stat64* stat)
{
    return __lxstat64(_STAT_VER, filename, stat);
}

extern "C" int __xstat64(int ver, const char* filename, struct stat64* stat);
extern "C" int __wrap_stat64(const char* filename, struct stat64* stat)
{
    return __xstat64(_STAT_VER, filename, stat);
}

extern "C" int __fxstat64(int ver, int fd, struct stat64* stat);
extern "C" int __wrap_fstat64(int fd, struct stat64* stat)
{
    return __fxstat64(_STAT_VER, fd, stat);
}

extern "C" int __fxstatat64(int ver, int dirfd, const char* path, struct stat64* stat, int flags);
extern "C" int __wrap_fstatat64(int dirfd, const char* path, struct stat64* stat, int flags)
{
    return __fxstatat64(_STAT_VER, dirfd, path, stat, flags);
}

extern "C" int __xmknod(int ver, const char* path, mode_t mode, dev_t dev);
extern "C" int __wrap_mknod(const char* path, mode_t mode, dev_t dev)
{
    return __xmknod(_MKNOD_VER, path, mode, dev);
}

extern "C" int __xmknodat(int ver, int dirfd, const char* path, mode_t mode, dev_t dev);
extern "C" int __wrap_mknodat(int dirfd, const char* path, mode_t mode, dev_t dev)
{
    return __xmknodat(_MKNOD_VER, dirfd, path, mode, dev);
}

#endif

double __wrap_exp(double x)
{
    return exp(x);
}
double __wrap_fmod(double x, double y) { return fmod(x, y); }
double __wrap_log(double x) { return log(x); }
double __wrap_log2(double x) { return log2(x); }
double __wrap_pow(double x, double y) { return pow(x, y); }
float __wrap_powf(float x, float y) { return powf(x, y); }
float __wrap_cosf(float x) { return cosf(x); }
float __wrap_expf(float x) { return expf(x); }
float __wrap_fmodf(float x, float y) { return fmodf(x, y); }
float __wrap_log10f(float x) { return log10f(x); }
float __wrap_log2f(float x) { return log2f(x); }
float __wrap_logf(float x) { return logf(x); }
float __wrap_sinf(float x) { return sinf(x); }
float __wrap_tanf(float x) { return tanf(x); }
void __wrap_sincosf(float x, float* sin_x, float* cos_x) { sincosf(x, sin_x, cos_x); }
}

// ban statx, for now
extern "C" int __wrap_statx(int fd, const char* path, int flags,
    unsigned int mask, struct statx* buf)
{
    errno = ENOSYS;
#ifdef BUN_DEBUG
    abort();
#endif
    return -1;
}

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

void std::__libcpp_verbose_abort(char const* format, ...)
{
    va_list list;
    va_start(list, format);
    char buffer[1024];
    size_t len = vsnprintf(buffer, sizeof(buffer), format, list);
    va_end(list);

    Bun__panic(buffer, len);
}

#endif

#ifndef U_SHOW_CPLUSPLUS_API
#define U_SHOW_CPLUSPLUS_API 0
#endif

#include <unicode/uchar.h>

extern "C" bool icu_hasBinaryProperty(UChar32 cp, unsigned int prop)
{
    return u_hasBinaryProperty(cp, static_cast<UProperty>(prop));
}
