#ifndef UNLIKELY
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif

// if linux
#if defined(__linux__)

#include <fcntl.h>
// #include <sys/stat.h>
#include <stdarg.h>
#include <math.h>
#include <errno.h>
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
// Force older versions of symbols
__asm__(".symver pow,pow@GLIBC_2.2.5");
__asm__(".symver log,log@GLIBC_2.2.5");
#endif

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

extern "C" int __real_fcntl(int fd, int cmd, ...);
typedef double (*MathFunction)(double);

static inline double __real_exp(double x)
{
    static MathFunction function = nullptr;
    if (UNLIKELY(function == nullptr)) {
        function = reinterpret_cast<MathFunction>(dlsym(nullptr, "exp"));
        if (UNLIKELY(function == nullptr))
            abort();
    }

    return function(x);
}
static inline double __real_log(double x)
{
    static MathFunction function = nullptr;
    if (UNLIKELY(function == nullptr)) {
        function = reinterpret_cast<MathFunction>(dlsym(nullptr, "log"));
        if (UNLIKELY(function == nullptr))
            abort();
    }

    return function(x);
}
static inline double __real_log2(double x)
{
    static MathFunction function = nullptr;
    if (UNLIKELY(function == nullptr)) {
        function = reinterpret_cast<MathFunction>(dlsym(nullptr, "log2"));
        if (UNLIKELY(function == nullptr))
            abort();
    }

    return function(x);
}

extern "C" int __wrap_fcntl(int fd, int cmd, ...)
{
    va_list va;
    va_start(va, cmd);
    return __real_fcntl(fd, cmd, va_arg(va, void*));
    va_end(va);
}

extern "C" int __wrap_fcntl64(int fd, int cmd, ...)
{
    va_list va;
    va_start(va, cmd);
    return __real_fcntl(fd, cmd, va_arg(va, void*));
    va_end(va);
}

extern "C" double __wrap_pow(double x, double y)
{
    static void* pow_ptr = nullptr;
    if (UNLIKELY(pow_ptr == nullptr)) {
        pow_ptr = dlsym(RTLD_DEFAULT, "pow");
    }

    return ((double (*)(double, double))pow_ptr)(x, y);
}

extern "C" double __wrap_exp(double x)
{
    return __real_exp(x);
}

extern "C" double __wrap_log(double x)
{
    return __real_log(x);
}

extern "C" double __wrap_log2(double x)
{
    return __real_log2(x);
}

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

extern "C" int __xmknod(int ver, const char* path, __mode_t mode, __dev_t dev);
extern "C" int __wrap_mknod(const char* path, __mode_t mode, __dev_t dev)
{
    return __xmknod(_MKNOD_VER, path, mode, dev);
}

extern "C" int __xmknodat(int ver, int dirfd, const char* path, __mode_t mode, __dev_t dev);
extern "C" int __wrap_mknodat(int dirfd, const char* path, __mode_t mode, __dev_t dev)
{
    return __xmknodat(_MKNOD_VER, dirfd, path, mode, dev);
}

#endif

// macOS
#if defined(__APPLE__)

#include <dlfcn.h>

extern "C" int pthread_self_is_exiting_np()
{
    static void* pthread_self_is_exiting_np_ptr = nullptr;
    static bool pthread_self_is_exiting_np_ptr_initialized = false;
    if (UNLIKELY(!pthread_self_is_exiting_np_ptr_initialized)) {
        pthread_self_is_exiting_np_ptr_initialized = true;
        pthread_self_is_exiting_np_ptr = dlsym(RTLD_DEFAULT, "pthread_self_is_exiting_np");
    }

    if (UNLIKELY(pthread_self_is_exiting_np_ptr == nullptr))
        return 0;

    return ((int (*)())pthread_self_is_exiting_np_ptr)();
}

extern "C" int posix_spawn_file_actions_addchdir_np(
    void* file_actions,
    const char* path)
{
    static void* posix_spawn_file_actions_addchdir_np_ptr = nullptr;
    static bool posix_spawn_file_actions_addchdir_np_ptr_initialized = false;
    if (UNLIKELY(!posix_spawn_file_actions_addchdir_np_ptr_initialized)) {
        posix_spawn_file_actions_addchdir_np_ptr_initialized = true;
        posix_spawn_file_actions_addchdir_np_ptr = dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_addchdir_np");
    }

    if (UNLIKELY(posix_spawn_file_actions_addchdir_np_ptr == nullptr))
        return 0;

    return ((int (*)(void*, const char*))posix_spawn_file_actions_addchdir_np_ptr)(file_actions, path);
}

extern "C" int posix_spawn_file_actions_addinherit_np(void* ptr,
    int status)
{
    static void* posix_spawn_file_actions_addinherit_np_ptr = nullptr;
    static bool posix_spawn_file_actions_addinherit_np_ptr_initialized = false;
    if (UNLIKELY(!posix_spawn_file_actions_addinherit_np_ptr_initialized)) {
        posix_spawn_file_actions_addinherit_np_ptr_initialized = true;
        posix_spawn_file_actions_addinherit_np_ptr = dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_addinherit_np");
    }

    if (UNLIKELY(posix_spawn_file_actions_addinherit_np_ptr == nullptr))
        return 0;

    return ((int (*)(void*, int))posix_spawn_file_actions_addinherit_np_ptr)(ptr, status);
}

extern "C" int posix_spawn_file_actions_addfchdir_np(void* ptr,
    int fd)
{
    static void* posix_spawn_file_actions_addfchdir_np_ptr = nullptr;
    static bool posix_spawn_file_actions_addfchdir_np_ptr_initialized = false;
    if (UNLIKELY(!posix_spawn_file_actions_addfchdir_np_ptr_initialized)) {
        posix_spawn_file_actions_addfchdir_np_ptr_initialized = true;
        posix_spawn_file_actions_addfchdir_np_ptr = dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_addfchdir_np");
    }

    if (UNLIKELY(posix_spawn_file_actions_addfchdir_np_ptr == nullptr))
        return 0;

    return ((int (*)(void*, int))posix_spawn_file_actions_addfchdir_np_ptr)(ptr, fd);
}

#endif
