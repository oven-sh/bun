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

// Add symbol versions for libc and threading functions
__asm__(".symver __libc_start_main,__libc_start_main@GLIBC_2.2.5");
__asm__(".symver dladdr,dladdr@GLIBC_2.2.5");
__asm__(".symver dlclose,dlclose@GLIBC_2.2.5");
__asm__(".symver dlerror,dlerror@GLIBC_2.2.5");
__asm__(".symver dlopen,dlopen@GLIBC_2.2.5");
__asm__(".symver dlsym,dlsym@GLIBC_2.2.5");
__asm__(".symver dlvsym,dlvsym@GLIBC_2.2.5");
__asm__(".symver getrandom,getrandom@GLIBC_2.25");

// Add symbol versions for pthread functions
__asm__(".symver pthread_attr_getstack,pthread_attr_getstack@GLIBC_2.2.5");
__asm__(".symver pthread_attr_setguardsize,pthread_attr_setguardsize@GLIBC_2.2.5");
__asm__(".symver pthread_attr_setstacksize,pthread_attr_setstacksize@GLIBC_2.2.5");
__asm__(".symver pthread_create,pthread_create@GLIBC_2.2.5");
__asm__(".symver pthread_detach,pthread_detach@GLIBC_2.2.5");
__asm__(".symver pthread_getattr_np,pthread_getattr_np@GLIBC_2.2.5");
__asm__(".symver pthread_getspecific,pthread_getspecific@GLIBC_2.2.5");
__asm__(".symver pthread_join,pthread_join@GLIBC_2.2.5");
__asm__(".symver pthread_key_create,pthread_key_create@GLIBC_2.2.5");
__asm__(".symver pthread_key_delete,pthread_key_delete@GLIBC_2.2.5");
__asm__(".symver pthread_kill,pthread_kill@GLIBC_2.2.5");
__asm__(".symver pthread_mutex_trylock,pthread_mutex_trylock@GLIBC_2.2.5");
__asm__(".symver pthread_mutexattr_destroy,pthread_mutexattr_destroy@GLIBC_2.2.5");
__asm__(".symver pthread_mutexattr_init,pthread_mutexattr_init@GLIBC_2.2.5");
__asm__(".symver pthread_mutexattr_settype,pthread_mutexattr_settype@GLIBC_2.2.5");
__asm__(".symver pthread_once,pthread_once@GLIBC_2.2.5");
__asm__(".symver pthread_rwlock_destroy,pthread_rwlock_destroy@GLIBC_2.2.5");
__asm__(".symver pthread_rwlock_init,pthread_rwlock_init@GLIBC_2.2.5");
__asm__(".symver pthread_rwlock_rdlock,pthread_rwlock_rdlock@GLIBC_2.2.5");
__asm__(".symver pthread_rwlock_unlock,pthread_rwlock_unlock@GLIBC_2.2.5");
__asm__(".symver pthread_rwlock_wrlock,pthread_rwlock_wrlock@GLIBC_2.2.5");
__asm__(".symver pthread_setspecific,pthread_setspecific@GLIBC_2.2.5");
__asm__(".symver pthread_sigmask,pthread_sigmask@GLIBC_2.2.5");
__asm__(".symver quick_exit,quick_exit@GLIBC_2.2.5");
__asm__(".symver sem_init,sem_init@GLIBC_2.2.5");
__asm__(".symver sem_post,sem_post@GLIBC_2.2.5");
__asm__(".symver sem_wait,sem_wait@GLIBC_2.2.5");
__asm__(".symver __pthread_key_create,__pthread_key_create@GLIBC_2.2.5");

#elif defined(__aarch64__)
__asm__(".symver __libc_start_main,__libc_start_main@GLIBC_2.17");
__asm__(".symver __pthread_key_create,__pthread_key_create@GLIBC_2.17");
__asm__(".symver _dl_find_object,_dl_find_object@GLIBC_2.17");
__asm__(".symver cosf,cosf@GLIBC_2.17");
__asm__(".symver dladdr,dladdr@GLIBC_2.17");
__asm__(".symver dlclose,dlclose@GLIBC_2.17");
__asm__(".symver dlerror,dlerror@GLIBC_2.17");
__asm__(".symver dlopen,dlopen@GLIBC_2.17");
__asm__(".symver dlsym,dlsym@GLIBC_2.17");
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
__asm__(".symver pthread_attr_getstack,pthread_attr_getstack@GLIBC_2.17");
__asm__(".symver pthread_attr_setguardsize,pthread_attr_setguardsize@GLIBC_2.17");
__asm__(".symver pthread_attr_setstacksize,pthread_attr_setstacksize@GLIBC_2.17");
__asm__(".symver pthread_create,pthread_create@GLIBC_2.17");
__asm__(".symver pthread_detach,pthread_detach@GLIBC_2.17");
__asm__(".symver pthread_getattr_np,pthread_getattr_np@GLIBC_2.17");
__asm__(".symver pthread_getspecific,pthread_getspecific@GLIBC_2.17");
__asm__(".symver pthread_join,pthread_join@GLIBC_2.17");
__asm__(".symver pthread_key_create,pthread_key_create@GLIBC_2.17");
__asm__(".symver pthread_key_delete,pthread_key_delete@GLIBC_2.17");
__asm__(".symver pthread_kill,pthread_kill@GLIBC_2.17");
__asm__(".symver pthread_mutex_trylock,pthread_mutex_trylock@GLIBC_2.17");
__asm__(".symver pthread_mutexattr_destroy,pthread_mutexattr_destroy@GLIBC_2.17");
__asm__(".symver pthread_mutexattr_init,pthread_mutexattr_init@GLIBC_2.17");
__asm__(".symver pthread_mutexattr_settype,pthread_mutexattr_settype@GLIBC_2.17");
__asm__(".symver pthread_once,pthread_once@GLIBC_2.17");
__asm__(".symver pthread_rwlock_destroy,pthread_rwlock_destroy@GLIBC_2.17");
__asm__(".symver pthread_rwlock_init,pthread_rwlock_init@GLIBC_2.17");
__asm__(".symver pthread_rwlock_rdlock,pthread_rwlock_rdlock@GLIBC_2.17");
__asm__(".symver pthread_rwlock_unlock,pthread_rwlock_unlock@GLIBC_2.17");
__asm__(".symver pthread_rwlock_wrlock,pthread_rwlock_wrlock@GLIBC_2.17");
__asm__(".symver pthread_setspecific,pthread_setspecific@GLIBC_2.17");
__asm__(".symver pthread_sigmask,pthread_sigmask@GLIBC_2.17");
__asm__(".symver sem_init,sem_init@GLIBC_2.17");
__asm__(".symver sem_post,sem_post@GLIBC_2.17");
__asm__(".symver sem_wait,sem_wait@GLIBC_2.17");
__asm__(".symver sincosf,sincosf@GLIBC_2.17");
__asm__(".symver sinf,sinf@GLIBC_2.17");
__asm__(".symver tanf,tanf@GLIBC_2.17");

#endif // aarch64

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

// Add new declarations for scanning/conversion functions
int BUN_WRAP_GLIBC_SYMBOL(sscanf)(const char*, const char*, ...);
long int BUN_WRAP_GLIBC_SYMBOL(strtol)(const char*, char**, int);
unsigned long int BUN_WRAP_GLIBC_SYMBOL(strtoul)(const char*, char**, int);
unsigned long long int BUN_WRAP_GLIBC_SYMBOL(strtoull)(const char*, char**, int);
int BUN_WRAP_GLIBC_SYMBOL(vfscanf)(FILE*, const char*, va_list);
int BUN_WRAP_GLIBC_SYMBOL(vscanf)(const char*, va_list);
int BUN_WRAP_GLIBC_SYMBOL(vsscanf)(const char*, const char*, va_list);

// Add declarations for pthread functions
int BUN_WRAP_GLIBC_SYMBOL(pthread_attr_getstack)(const pthread_attr_t*, void**, size_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_attr_setguardsize)(pthread_attr_t*, size_t);
int BUN_WRAP_GLIBC_SYMBOL(pthread_attr_setstacksize)(pthread_attr_t*, size_t);
int BUN_WRAP_GLIBC_SYMBOL(pthread_create)(pthread_t*, const pthread_attr_t*, void* (*)(void*), void*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_detach)(pthread_t);
int BUN_WRAP_GLIBC_SYMBOL(pthread_getattr_np)(pthread_t, pthread_attr_t*);
void* BUN_WRAP_GLIBC_SYMBOL(pthread_getspecific)(pthread_key_t);
int BUN_WRAP_GLIBC_SYMBOL(pthread_join)(pthread_t, void**);
int BUN_WRAP_GLIBC_SYMBOL(pthread_key_create)(pthread_key_t*, void (*)(void*));
int BUN_WRAP_GLIBC_SYMBOL(__pthread_key_create)(pthread_key_t*, void (*)(void*));
int BUN_WRAP_GLIBC_SYMBOL(pthread_key_delete)(pthread_key_t);
int BUN_WRAP_GLIBC_SYMBOL(pthread_kill)(pthread_t, int);
int BUN_WRAP_GLIBC_SYMBOL(pthread_mutex_trylock)(pthread_mutex_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_mutexattr_destroy)(pthread_mutexattr_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_mutexattr_init)(pthread_mutexattr_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_mutexattr_settype)(pthread_mutexattr_t*, int);
int BUN_WRAP_GLIBC_SYMBOL(pthread_once)(pthread_once_t*, void (*)(void));
int BUN_WRAP_GLIBC_SYMBOL(pthread_rwlock_destroy)(pthread_rwlock_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_rwlock_init)(pthread_rwlock_t*, const pthread_rwlockattr_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_rwlock_rdlock)(pthread_rwlock_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_rwlock_unlock)(pthread_rwlock_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_rwlock_wrlock)(pthread_rwlock_t*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_setspecific)(pthread_key_t, const void*);
int BUN_WRAP_GLIBC_SYMBOL(pthread_sigmask)(int, const sigset_t*, sigset_t*);
void* BUN_WRAP_GLIBC_SYMBOL(pthread_getspecific)(pthread_key_t key);

// Add declarations for other system functions
void BUN_WRAP_GLIBC_SYMBOL(arc4random_buf)(void*, size_t);
ssize_t BUN_WRAP_GLIBC_SYMBOL(getrandom)(void*, size_t, unsigned int);
_Noreturn void BUN_WRAP_GLIBC_SYMBOL(quick_exit)(int);
int BUN_WRAP_GLIBC_SYMBOL(sem_init)(sem_t*, int, unsigned int);
int BUN_WRAP_GLIBC_SYMBOL(sem_post)(sem_t*);
int BUN_WRAP_GLIBC_SYMBOL(sem_wait)(sem_t*);

// Add declarations for dynamic linking functions
int BUN_WRAP_GLIBC_SYMBOL(dladdr)(const void*, Dl_info*);
int BUN_WRAP_GLIBC_SYMBOL(dlclose)(void*);
char* BUN_WRAP_GLIBC_SYMBOL(dlerror)(void);
void* BUN_WRAP_GLIBC_SYMBOL(dlopen)(const char*, int);
void* BUN_WRAP_GLIBC_SYMBOL(dlsym)(void*, const char*);
void* BUN_WRAP_GLIBC_SYMBOL(dlvsym)(void*, const char*, const char*);

int BUN_WRAP_GLIBC_SYMBOL(__libc_start_main)(int (*main)(int, char**, char**), int argc, char** argv, int (*init)(void), void (*fini)(void), void (*rtld_fini)(void), void* stack_end);

#if defined(__x86_64__) || defined(__aarch64__)

double __wrap_exp(double x) { return exp(x); }
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

// ban statx, for now
int __wrap_statx(int fd, const char* path, int flags,
    unsigned int mask, struct statx* buf)
{
    errno = ENOSYS;
#ifdef BUN_DEBUG
    abort();
#endif
    return -1;
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

int __wrap_fcntl64(int fd, int cmd, ...)
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

void __wrap_arc4random_buf(void* buf, size_t nbytes)
{
    getrandom(buf, nbytes, 0);
}

int __wrap_sem_init(sem_t* sem, int pshared, unsigned int value)
{
    return sem_init(sem, pshared, value);
}

int __wrap_sem_post(sem_t* sem)
{
    return sem_post(sem);
}

int __wrap_sem_wait(sem_t* sem)
{
    return sem_wait(sem);
}

// https://www.gnu.org/software/libc/manual/html_node/Single_002dThreaded.html
char __wrap___libc_single_threaded = 0;

int __libc_start_main(int (*main)(int, char**, char**), int argc, char** argv, int (*init)(void), void (*fini)(void), void (*rtld_fini)(void), void* stack_end);

int __wrap___libc_start_main(int (*main)(int, char**, char**), int argc, char** argv, int (*init)(void), void (*fini)(void), void (*rtld_fini)(void), void* stack_end)
{
    return __libc_start_main(main, argc, argv, init, fini, rtld_fini, stack_end);
}

// pthread function wrappers
int __wrap_pthread_attr_getstack(const pthread_attr_t* attr, void** stackaddr, size_t* stacksize)
{
    return pthread_attr_getstack(attr, stackaddr, stacksize);
}

int __wrap_pthread_attr_setguardsize(pthread_attr_t* attr, size_t guardsize)
{
    return pthread_attr_setguardsize(attr, guardsize);
}

int __wrap_pthread_attr_setstacksize(pthread_attr_t* attr, size_t stacksize)
{
    return pthread_attr_setstacksize(attr, stacksize);
}

int __wrap_pthread_create(pthread_t* thread, const pthread_attr_t* attr, void* (*start_routine)(void*), void* arg)
{
    return pthread_create(thread, attr, start_routine, arg);
}

int __wrap_pthread_detach(pthread_t thread)
{
    return pthread_detach(thread);
}

int __wrap_pthread_getattr_np(pthread_t thread, pthread_attr_t* attr)
{
    return pthread_getattr_np(thread, attr);
}

void* __wrap_pthread_getspecific(pthread_key_t key)
{
    return pthread_getspecific(key);
}

int __wrap_pthread_join(pthread_t thread, void** retval)
{
    return pthread_join(thread, retval);
}

int __wrap_pthread_key_create(pthread_key_t* key, void (*destructor)(void*))
{
    return pthread_key_create(key, destructor);
}

int __wrap___pthread_key_create(pthread_key_t* key, void (*destructor)(void*))
{
    return pthread_key_create(key, destructor);
}

int __wrap_pthread_key_delete(pthread_key_t key)
{
    return pthread_key_delete(key);
}

int __wrap_pthread_kill(pthread_t thread, int sig)
{
    return pthread_kill(thread, sig);
}

int __wrap_pthread_mutex_trylock(pthread_mutex_t* mutex)
{
    return pthread_mutex_trylock(mutex);
}

int __wrap_pthread_mutexattr_destroy(pthread_mutexattr_t* attr)
{
    return pthread_mutexattr_destroy(attr);
}

int __wrap_pthread_mutexattr_init(pthread_mutexattr_t* attr)
{
    return pthread_mutexattr_init(attr);
}

int __wrap_pthread_mutexattr_settype(pthread_mutexattr_t* attr, int type)
{
    return pthread_mutexattr_settype(attr, type);
}

int __wrap_pthread_once(pthread_once_t* once_control, void (*init_routine)(void))
{
    return pthread_once(once_control, init_routine);
}

int __wrap_pthread_rwlock_destroy(pthread_rwlock_t* rwlock)
{
    return pthread_rwlock_destroy(rwlock);
}

int __wrap_pthread_rwlock_init(pthread_rwlock_t* rwlock, const pthread_rwlockattr_t* attr)
{
    return pthread_rwlock_init(rwlock, attr);
}

int __wrap_pthread_rwlock_rdlock(pthread_rwlock_t* rwlock)
{
    return pthread_rwlock_rdlock(rwlock);
}

int __wrap_pthread_rwlock_unlock(pthread_rwlock_t* rwlock)
{
    return pthread_rwlock_unlock(rwlock);
}

int __wrap_pthread_rwlock_wrlock(pthread_rwlock_t* rwlock)
{
    return pthread_rwlock_wrlock(rwlock);
}

int __wrap_pthread_setspecific(pthread_key_t key, const void* value)
{
    return pthread_setspecific(key, value);
}

int __wrap_pthread_sigmask(int how, const sigset_t* set, sigset_t* oldset)
{
    return pthread_sigmask(how, set, oldset);
}

// Dynamic linking function wrappers
int __wrap_dladdr(const void* addr, Dl_info* info)
{
    return dladdr(addr, info);
}

int __wrap_dlclose(void* handle)
{
    return dlclose(handle);
}

char* __wrap_dlerror(void)
{
    return dlerror();
}

void* __wrap_dlopen(const char* filename, int flags)
{
    return dlopen(filename, flags);
}

void* __wrap_dlsym(void* handle, const char* symbol)
{
    return dlsym(handle, symbol);
}

#endif // x86_64 or aarch64

#if defined(__x86_64__)

// Scanning/conversion function wrappers
int __wrap_sscanf(const char* str, const char* format, ...)
{
    va_list ap;
    va_start(ap, format);
    int result = vsscanf(str, format, ap);
    va_end(ap);
    return result;
}

long int __wrap_strtol(const char* nptr, char** endptr, int base)
{
    return strtol(nptr, endptr, base);
}

unsigned long int __wrap_strtoul(const char* nptr, char** endptr, int base)
{
    return strtoul(nptr, endptr, base);
}

unsigned long long int __wrap_strtoull(const char* nptr, char** endptr, int base)
{
    return strtoull(nptr, endptr, base);
}

unsigned long int __wrap___isoc23_strtoul(const char* nptr, char** endptr, int base)
{
    return strtoul(nptr, endptr, base);
}

long int __wrap___isoc23_strtol(const char* nptr, char** endptr, int base)
{
    return strtol(nptr, endptr, base);
}

unsigned long long int __wrap___isoc23_strtoull(const char* nptr, char** endptr, int base)
{
    return strtoull(nptr, endptr, base);
}

int __wrap___isoc23_sscanf(const char* str, const char* format, ...)
{
    va_list ap;
    va_start(ap, format);
    int result = vsscanf(str, format, ap);
    va_end(ap);
    return result;
}

int __wrap___isoc23_vscanf(const char* format, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vscanf(format, ap_copy);
    va_end(ap_copy);
    return result;
}

int __wrap_vfscanf(FILE* stream, const char* format, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vfscanf(stream, format, ap_copy);
    va_end(ap_copy);
    return result;
}

int __wrap_vscanf(const char* format, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vscanf(format, ap_copy);
    va_end(ap_copy);
    return result;
}

int __wrap_vsscanf(const char* str, const char* format, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vsscanf(str, format, ap_copy);
    va_end(ap_copy);
    return result;
}

int __wrap___isoc23_vfscanf(FILE* stream, const char* format, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vfscanf(stream, format, ap_copy);
    va_end(ap_copy);
    return result;
}

int __wrap___isoc23_vsscanf(const char* str, const char* format, va_list ap)
{
    va_list ap_copy;
    va_copy(ap_copy, ap);
    int result = vsscanf(str, format, ap_copy);
    va_end(ap_copy);
    return result;
}

void* __wrap_dlvsym(void* handle, const char* symbol, const char* version)
{
    return dlvsym(handle, symbol, version);
}

// Other system function wrappers
ssize_t __wrap_getrandom(void* buffer, size_t length, unsigned int flags)
{
    return getrandom(buffer, length, flags);
}

_Noreturn void __wrap_quick_exit(int status)
{
    typedef void (*quick_exit_func)(int) __attribute__((noreturn));
    static std::once_flag quick_exit_initialized;
    static quick_exit_func quick_exit;
    std::call_once(quick_exit_initialized, []() {
        quick_exit = (quick_exit_func)dlsym(RTLD_NEXT, "quick_exit");
        if (UNLIKELY(!quick_exit)) {
            quick_exit = _exit;
        }
    });

    quick_exit(status);
}

int __wrap_fcntl(int fd, int cmd, ...)
{
    va_list args;
    va_start(args, cmd);
    void* arg = va_arg(args, void*);
    va_end(args);
    return fcntl(fd, cmd, arg);
}

int __wrap__dl_find_object(void* address, struct dl_find_object* result)
{
    return _dl_find_object(address, result);
}

#endif // x86_64

#if defined(__aarch64__)

// This function is only called by the unwind implementation, which won't be run in the first place
// since we don't allow C++ exceptions (any thrown will just go to the crash handler)
int __wrap__dl_find_object(void* address, struct dl_find_object* result)
{
    abort();
}

#endif // aarch64

} // extern "C"

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
