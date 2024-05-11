
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
typedef double (*MathFunction2)(double, double);

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
static inline double __real_fmod(double x, double y)
{
    static MathFunction2 function = nullptr;
    if (UNLIKELY(function == nullptr)) {
        function = reinterpret_cast<MathFunction2>(dlsym(nullptr, "fmod"));
        if (UNLIKELY(function == nullptr))
            abort();
    }

    return function(x, y);
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

extern "C" double __wrap_fmod(double x, double y)
{
    return __real_fmod(x, y);
}

static inline float __real_expf(float arg)
{
    static void* ptr = nullptr;
    if (UNLIKELY(ptr == nullptr)) {
        ptr = dlsym(RTLD_DEFAULT, "expf");
    }

    return ((float (*)(float))ptr)(arg);
}

extern "C" float __wrap_expf(float arg)
{
    return __real_expf(arg);
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
#include <cstdint>
#include <sys/cdefs.h>
#include <sys/types.h>
#include <sys/_types/_socklen_t.h>
#include <sys/_types/_fd_def.h>
#include <sys/_types/_pid_t.h>
#include <stdarg.h>

#pragma mark - Aliases
// To get the list of symbols from bun, run:
//
//    nm -g $(which bun-debug)
//
// To get the list of $NOCANCEL symbols, run:
//
//    curl https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/syscalls.master | grep _nocancel
//
// This enforces we only use the $NOCANCEL version of these syscalls without having to change every call site.
// It would be better to do this via `-alias` in the linker, but for reasons that aren't clear, that doesn't work.
extern "C" int connect$NOCANCEL(int fd, const struct sockaddr* addr, socklen_t addrlen);
extern "C" int connect(int fd, const struct sockaddr* addr, socklen_t addrlen)
{
    return connect$NOCANCEL(fd, addr, addrlen);
}

// We cannot use accept() due to an obscure linking issue with WebKit
// extern "C" int accept$NOCANCEL(int fd, struct sockaddr* __restrict addr, socklen_t* __restrict addrlen);
// extern "C" int accept(int fd, struct sockaddr* __restrict addr, socklen_t* __restrict addrlen)
// {
//     return accept$NOCANCEL(fd, addr, addrlen);
// }

extern "C" int close$NOCANCEL(int fd);
extern "C" int close(int fd)
{
    return close$NOCANCEL(fd);
}

extern "C" int fcntl$NOCANCEL(int fd, int cmd, ...);
extern "C" int fcntl(int fd, int cmd, ...)
{
    va_list va;
    va_start(va, cmd);
    return fcntl$NOCANCEL(fd, cmd, va_arg(va, long));
}
extern "C" int fsync$NOCANCEL(int fd);
extern "C" int fsync(int fd)
{
    return fsync$NOCANCEL(fd);
}

extern "C" int openat$NOCANCEL(int fd, const char* path, int flags, ...);
extern "C" int openat(int fd, const char* path, int flags, int mode)
{
    return openat$NOCANCEL(fd, path, flags, mode);
}

#ifndef AT_FDCWD
#define AT_FDCWD -2
#endif

extern "C" int open(const char* path, int flags, ...)
{
    va_list va;
    va_start(va, flags);
    return openat$NOCANCEL(AT_FDCWD, path, flags, va_arg(va, void*));
}

extern "C" int read$NOCANCEL(int fd, void* buf, size_t count);
extern "C" int read(int fd, void* buf, size_t count)
{
    return read$NOCANCEL(fd, buf, count);
}

extern "C" int write$NOCANCEL(int fd, const void* buf, size_t count);
extern "C" int write(int fd, const void* buf, size_t count)
{
    return write$NOCANCEL(fd, buf, count);
}

extern "C" int recvfrom$NOCANCEL(int fd, void* buf, size_t count, int flags, struct sockaddr* __restrict addr, socklen_t* __restrict addrlen);
extern "C" int recvfrom(int fd, void* buf, size_t count, int flags, struct sockaddr* __restrict addr, socklen_t* __restrict addrlen)
{
    return recvfrom$NOCANCEL(fd, buf, count, flags, addr, addrlen);
}

extern "C" int recv$NOCANCEL(int fd, void* buf, size_t count, int flags);
extern "C" int recv(int fd, void* buf, size_t count, int flags)
{
    return recv$NOCANCEL(fd, buf, count, flags);
}

extern "C" int sendmsg$NOCANCEL(int fd, const struct msghdr* msg, int flags);
extern "C" int sendmsg(int fd, const struct msghdr* msg, int flags)
{
    return sendmsg$NOCANCEL(fd, msg, flags);
}

typedef unsigned int nfds_t;
extern "C" int poll$NOCANCEL(struct pollfd* fds, unsigned int nfds, int timeout);
extern "C" int poll(struct pollfd* fds, unsigned int nfds, int timeout)
{
    return poll$NOCANCEL(fds, nfds, timeout);
}

extern "C" int select$NOCANCEL(int nfds, fd_set* readfds, fd_set* writefds, fd_set* exceptfds, struct timeval* timeout);
extern "C" int select(int nfds, fd_set* readfds, fd_set* writefds, fd_set* exceptfds, struct timeval* timeout)
{
    return select$NOCANCEL(nfds, readfds, writefds, exceptfds, timeout);
}

extern "C" int pread$NOCANCEL(int fd, void* buf, size_t count, off_t offset);
extern "C" int pread(int fd, void* buf, size_t count, off_t offset)
{
    return pread$NOCANCEL(fd, buf, count, offset);
}

extern "C" int pwrite$NOCANCEL(int fd, const void* buf, size_t count, off_t offset);
extern "C" int pwrite(int fd, const void* buf, size_t count, off_t offset)
{
    return pwrite$NOCANCEL(fd, buf, count, offset);
}

extern "C" int pwritev$NOCANCEL(int fd, const struct iovec* iov, int iovcnt, off_t offset);
extern "C" int pwritev(int fd, const struct iovec* iov, int iovcnt, off_t offset)
{
    return pwritev$NOCANCEL(fd, iov, iovcnt, offset);
}

extern "C" int readv$NOCANCEL(int fd, const struct iovec* iov, int iovcnt);
extern "C" int readv(int fd, const struct iovec* iov, int iovcnt)
{
    return readv$NOCANCEL(fd, iov, iovcnt);
}

extern "C" int msync$NOCANCEL(void* addr, size_t length, int flags);
extern "C" int msync(void* addr, size_t length, int flags)
{
    return msync$NOCANCEL(addr, length, flags);
}

extern "C" int writev$NOCANCEL(int fd, const struct iovec* iov, int iovcnt);
extern "C" int writev(int fd, const struct iovec* iov, int iovcnt)
{
    return writev$NOCANCEL(fd, iov, iovcnt);
}

extern "C" int waitpid$NOCANCEL(pid_t pid, int* status, int options);
extern "C" int waitpid(pid_t pid, int* status, int options)
{
    return waitpid$NOCANCEL(pid, status, options);
}

#pragma mark - Overrides

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

extern "C" int __ulock_wait(uint32_t operation, void* addr, uint64_t value,
    uint32_t timeout_microseconds); /* timeout is specified in microseconds */

// https://github.com/oven-sh/bun/pull/2426#issuecomment-1532343394
extern "C" int __ulock_wait2(uint32_t operation, void* addr, uint64_t value,
    uint64_t timeout_ns, uint64_t value2)
{
    static void* __ulock_wait2_ptr = nullptr;
    static bool __ulock_wait2_ptr_initialized = false;
    if (UNLIKELY(!__ulock_wait2_ptr_initialized)) {
        __ulock_wait2_ptr_initialized = true;
        __ulock_wait2_ptr = dlsym(RTLD_DEFAULT, "__ulock_wait2");
    }

    if (UNLIKELY(__ulock_wait2_ptr == nullptr)) {
        uint64_t timeout = timeout_ns / 1000;
        uint32_t timeout_us = static_cast<uint32_t>(timeout > UINT32_MAX ? UINT32_MAX : timeout);
        return __ulock_wait(operation, addr, value, timeout_us);
    }

    return ((int (*)(uint32_t, void*, uint64_t, uint64_t, uint64_t))__ulock_wait2_ptr)(operation, addr, value, timeout_ns, value2);
}

#endif

#include <unicode/uchar.h>

extern "C" bool icu_hasBinaryProperty(UChar32 cp, unsigned int prop)
{
    return u_hasBinaryProperty(cp, static_cast<UProperty>(prop));
}
