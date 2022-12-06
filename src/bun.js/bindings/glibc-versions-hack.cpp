// if linux
#if defined(__linux__)

#include <fcntl.h>
//#include <sys/stat.h>
#include <stdarg.h>
#include <math.h>

#ifndef _STAT_VER
#if defined (__aarch64__)
#define _STAT_VER 0
#elif defined (__x86_64__)
#define _STAT_VER 1
#else
#define _STAT_VER 3
#endif
#endif


asm (".symver fcntl64, fcntl@GLIBC_2.2.5");  // Used when compiling with newer glibc headers
asm (".symver fcntl, fcntl@GLIBC_2.2.5");    // Used when compiling with older glibc headers
asm (".symver pow, pow@GLIBC_2.2.5");
asm (".symver exp, exp@GLIBC_2.2.5");
asm (".symver log, log@GLIBC_2.2.5");

extern "C" int __wrap_fcntl(int fd, int cmd, ...)
{
    // fcntl has 2 or 3 args, and I don't know whether it's safe to 
    // just define it with 3... glibc itself always seems to access that arg
    // as a pointer using va_arg, although the man page says it can be an int!
    va_list va;
    va_start(va, cmd);
    return fcntl(fd, cmd, va_arg(va, void*));
    va_end(va);
}


extern "C"  int __wrap_fcntl64(int fd, int cmd, ...)
{
    va_list va;
    va_start(va, cmd);
    return fcntl(fd, cmd, va_arg(va, void*));
    va_end(va);
}





// I couldn't figure out what has changed in pow, exp, log in glibc 2.29.
// Interestingly despite compiling with -fno-omit-frame-pointer, GCC
// optimises the following to a jmp anyway.

extern "C"  double __wrap_pow(double x, double y)
{
    return pow(x, y);
}

extern "C"  double __wrap_exp(double x)
{
    return exp(x);
}

extern "C"  double __wrap_log(double x)
{
    return log(x);
}

#ifndef _MKNOD_VER
#define _MKNOD_VER 1
#endif

extern "C" int __lxstat(int ver, const char *filename, struct stat *stat);
extern "C" int __wrap_lstat(const char *filename, struct stat *stat)
{
	return __lxstat(_STAT_VER, filename, stat);
}

extern "C" int __xstat(int ver, const char *filename, struct stat *stat);
extern "C" int __wrap_stat(const char *filename, struct stat *stat)
{
	return __xstat(_STAT_VER, filename, stat);
}

extern "C" int __fxstat(int ver, int fd, struct stat *stat);
extern "C" int __wrap_fstat(int fd, struct stat *stat)
{
	return __fxstat(_STAT_VER, fd, stat);
}

extern "C" int __fxstatat(int ver, int dirfd, const char *path, struct stat *stat, int flags);
extern "C" int __wrap_fstatat(int dirfd, const char *path, struct stat *stat, int flags)
{
	return __fxstatat(_STAT_VER, dirfd, path, stat, flags);
}

extern "C" int __lxstat64(int ver, const char *filename, struct stat64 *stat);
extern "C" int __wrap_lstat64(const char *filename, struct stat64 *stat)
{
	return __lxstat64(_STAT_VER, filename, stat);
}

extern "C" int __xstat64(int ver, const char *filename, struct stat64 *stat);
extern "C" int __wrap_stat64(const char *filename, struct stat64 *stat)
{
	return __xstat64(_STAT_VER, filename, stat);
}

extern "C" int __fxstat64(int ver, int fd, struct stat64 *stat);
extern "C" int __wrap_fstat64(int fd, struct stat64 *stat)
{
	return __fxstat64(_STAT_VER, fd, stat);
}

extern "C" int __fxstatat64(int ver, int dirfd, const char *path, struct stat64 *stat, int flags);
extern "C" int __wrap_fstatat64(int dirfd, const char *path, struct stat64 *stat, int flags)
{
	 return __fxstatat64(_STAT_VER, dirfd, path, stat, flags);
}

extern "C" int __xmknod(int ver, const char *path, __mode_t mode, __dev_t dev);
extern "C" int __wrap_mknod(const char *path, __mode_t mode, __dev_t dev)
{
	return __xmknod(_MKNOD_VER, path, mode, dev);
}

extern "C" int __xmknodat(int ver, int dirfd, const char *path, __mode_t mode, __dev_t dev);
extern "C" int __wrap_mknodat(int dirfd, const char *path, __mode_t mode, __dev_t dev)
{
	return __xmknodat(_MKNOD_VER, dirfd, path, mode, dev);
}

#endif