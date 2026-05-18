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

#if defined(__FreeBSD__) && !ASSERT_ENABLED
// WTF references this counter from text/StringCommon.h under STRING_STATS;
// Debug WebKit defines it (StringView.cpp); Release doesn't, but Bun's
// StringView.h usage still emits a reference.
#include <atomic>
namespace WTF::Detail {
std::atomic<int> wtfStringCopyCount;
}
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
#include <pthread.h>
#include <semaphore.h>
#include <stdio.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/random.h>
#include <sys/syscall.h>
#include <unistd.h>
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
#define BUN_GLIBC_BASE "GLIBC_2.2.5"
#define BUN_GLIBC_2_4 "GLIBC_2.4"
#elif defined(__aarch64__)
#define BUN_GLIBC_BASE "GLIBC_2.17"
#define BUN_GLIBC_2_4 "GLIBC_2.17"
#endif

#define BUN_SYMVER(sym, ver) __asm__(".symver " #sym "," #sym "@" ver)

BUN_SYMVER(exp, BUN_GLIBC_BASE);
BUN_SYMVER(exp2, BUN_GLIBC_BASE);
BUN_SYMVER(expf, BUN_GLIBC_BASE);
BUN_SYMVER(log, BUN_GLIBC_BASE);
BUN_SYMVER(log2, BUN_GLIBC_BASE);
BUN_SYMVER(log2f, BUN_GLIBC_BASE);
BUN_SYMVER(logf, BUN_GLIBC_BASE);
BUN_SYMVER(pow, BUN_GLIBC_BASE);
BUN_SYMVER(powf, BUN_GLIBC_BASE);

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
ssize_t BUN_WRAP_GLIBC_SYMBOL(getrandom)(void*, size_t, unsigned int);

float __wrap_expf(float x) { return expf(x); }
float __wrap_powf(float x, float y) { return powf(x, y); }
float __wrap_logf(float x) { return logf(x); }
float __wrap_log2f(float x) { return log2f(x); }
double __wrap_exp(double x) { return exp(x); }
double __wrap_exp2(double x) { return exp2(x); }
double __wrap_pow(double x, double y) { return pow(x, y); }
double __wrap_log(double x) { return log(x); }
double __wrap_log2(double x) { return log2(x); }

// glibc 2.24 added quick_exit@GLIBC_2.24 (the version that correctly skips
// thread_local dtors per C11/C++11; the older @2.10 version ran them — see
// glibc bug 20198). dlsym at runtime gets the host's default version: the
// correct one on ≥ 2.24, the only one available on 2.17–2.23. Either way we
// call exactly what a natively-built program on that host would call, without
// a link-time GLIBC_2.24 dependency.
[[noreturn]] void __wrap_quick_exit(int code)
{
    using qe_fn = void (*)(int);
    static qe_fn real = reinterpret_cast<qe_fn>(dlsym(RTLD_NEXT, "quick_exit"));
    real(code);
    __builtin_unreachable();
}

// glibc 2.25 added getrandom(); 2.41 added vDSO acceleration. Forward to
// glibc's when present so we keep the vDSO fast path on modern systems; on
// glibc < 2.25 issue the raw syscall ourselves. The kernel syscall has existed
// since Linux 3.17; on older kernels syscall() returns -1/ENOSYS, which all
// callers (BoringSSL, c-ares, highway) handle by falling back to /dev/urandom.
ssize_t __wrap_getrandom(void* buf, size_t buflen, unsigned int flags)
{
    using gr_fn = ssize_t (*)(void*, size_t, unsigned int);
    static gr_fn real = reinterpret_cast<gr_fn>(dlsym(RTLD_NEXT, "getrandom"));
    if (real) {
        return real(buf, buflen, flags);
    }
    return syscall(SYS_getrandom, buf, buflen, flags);
}

} // extern "C"

// glibc 2.18 added __cxa_thread_atexit_impl for C++11 thread_local destructors.
// All in-tree callers (libstdc++, libc++abi, Rust std) weak-reference it, but
// lld emits a non-weak GLIBC_2.18 verneed entry regardless, which the loader
// rejects on 2.17. Providing a strong definition here satisfies the link-time
// reference and removes the dynamic dependency.
//
// At runtime we forward to glibc's real implementation when present (≥ 2.18,
// i.e. effectively always); this preserves glibc's DSO-refcount handling so
// dlclose() of FFI/napi addons stays safe.
//
// The fallback for glibc 2.17 is libc++abi's, taken verbatim (modulo
// __libcpp_tls_* → pthread_* and abort_message → abort) from
// https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/libcxxabi/src/cxa_thread_atexit.cpp
// under the Apache-2.0 WITH LLVM-exception license. See LICENSE.md for the
// full text. Its documented limitations (dso_symbol ignored; main-thread dtors
// run at static-destruction time) apply only on glibc 2.17.
namespace {

using Dtor = void (*)(void*);

struct DtorList {
    Dtor dtor;
    void* obj;
    DtorList* next;
};

__thread DtorList* dtors = nullptr;
__thread bool dtors_alive = false;
pthread_key_t dtors_key;

void run_dtors(void*)
{
    while (auto head = dtors) {
        dtors = head->next;
        head->dtor(head->obj);
        ::free(head);
    }
    dtors_alive = false;
}

struct DtorsManager {
    DtorsManager()
    {
        if (pthread_key_create(&dtors_key, run_dtors) != 0) {
            abort();
        }
    }
    ~DtorsManager()
    {
        run_dtors(nullptr);
    }
};

} // namespace

extern "C" int __cxa_thread_atexit_impl(Dtor dtor, void* obj, void* dso_symbol)
{
    using impl_fn = int (*)(Dtor, void*, void*);
    static impl_fn real = reinterpret_cast<impl_fn>(dlsym(RTLD_NEXT, "__cxa_thread_atexit_impl"));
    if (real) {
        return real(dtor, obj, dso_symbol);
    }

    (void)dso_symbol;
    static DtorsManager manager;

    if (!dtors_alive) {
        if (pthread_setspecific(dtors_key, &dtors_key) != 0) {
            return -1;
        }
        dtors_alive = true;
    }

    auto head = static_cast<DtorList*>(::malloc(sizeof(DtorList)));
    if (!head) {
        return -1;
    }

    head->dtor = dtor;
    head->obj = obj;
    head->next = dtors;
    dtors = head;

    return 0;
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

extern "C" __attribute__((used)) char _libc_single_threaded = 0;
extern "C" __attribute__((used)) char __libc_single_threaded = 0;

// ───────────────────────────────────────────────────────────────────────────
// glibc 2.27–2.35 symbols pulled in by Rust std, host crt1.o, libgcc_eh,
// libarchive, and the ASAN runtime when building on a glibc ≥ 2.27 host.
// All have ABI-compatible older versions (or syscall fallbacks); pinning
// each __wrap_X to the floor version keeps verneed ≤ 2.17 regardless of
// build host. On a glibc 2.17 host these wraps are inert (the linker never
// sees the newer default version, so --wrap just routes through a no-op
// trampoline).
// ───────────────────────────────────────────────────────────────────────────

#include <sys/stat.h>
#include <spawn.h>

// Group A: libpthread/libdl symbols moved into libc.so in 2.34. The 2.2.5
// (x86_64) / 2.17 (aarch64) versions are ABI-identical aliases of the 2.34
// ones — glibc kept them as compat_symbol — so a plain .symver forward is
// correct on every glibc ≥ 2.17.
#define BUN_WRAP_FWD(ret, sym, params, args) \
    BUN_SYMVER(sym, BUN_GLIBC_BASE);         \
    extern "C" ret __wrap_##sym params { return sym args; }
#define BUN_WRAP_FWD_VOID(sym, params, args) \
    BUN_SYMVER(sym, BUN_GLIBC_BASE);         \
    extern "C" void __wrap_##sym params { sym args; }

BUN_WRAP_FWD(void*, dlsym, (void* h, const char* s), (h, s))
BUN_WRAP_FWD(void*, dlvsym, (void* h, const char* s, const char* v), (h, s, v))
BUN_WRAP_FWD(int, dladdr, (const void* a, Dl_info* i), (a, i))
BUN_WRAP_FWD(char*, dlerror, (), ())
BUN_WRAP_FWD(int, pthread_key_create, (pthread_key_t * k, void (*d)(void*)), (k, d))
BUN_WRAP_FWD(int, pthread_key_delete, (pthread_key_t k), (k))
BUN_WRAP_FWD(void*, pthread_getspecific, (pthread_key_t k), (k))
BUN_WRAP_FWD(int, pthread_setspecific, (pthread_key_t k, const void* v), (k, v))
BUN_WRAP_FWD(int, pthread_once, (pthread_once_t * o, void (*f)()), (o, f))
BUN_WRAP_FWD(int, pthread_mutexattr_init, (pthread_mutexattr_t * a), (a))
BUN_WRAP_FWD(int, pthread_mutexattr_settype, (pthread_mutexattr_t * a, int t), (a, t))
BUN_WRAP_FWD(int, pthread_mutexattr_destroy, (pthread_mutexattr_t * a), (a))
BUN_WRAP_FWD(int, pthread_mutex_trylock, (pthread_mutex_t * m), (m))
BUN_WRAP_FWD(int, pthread_rwlock_rdlock, (pthread_rwlock_t * l), (l))
BUN_WRAP_FWD(int, pthread_rwlock_wrlock, (pthread_rwlock_t * l), (l))
BUN_WRAP_FWD(int, pthread_rwlock_unlock, (pthread_rwlock_t * l), (l))
BUN_WRAP_FWD(int, pthread_rwlock_destroy, (pthread_rwlock_t * l), (l))
BUN_WRAP_FWD(int, pthread_attr_setstacksize, (pthread_attr_t * a, size_t s), (a, s))
BUN_WRAP_FWD(int, pthread_attr_setstack, (pthread_attr_t * a, void* s, size_t z), (a, s, z))
BUN_WRAP_FWD(int, pthread_getattr_np, (pthread_t t, pthread_attr_t* a), (t, a))
BUN_WRAP_FWD(int, pthread_kill, (pthread_t t, int s), (t, s))

BUN_SYMVER(__pthread_key_create, BUN_GLIBC_BASE);
extern "C" int __pthread_key_create(pthread_key_t*, void (*)(void*));
extern "C" int __wrap___pthread_key_create(pthread_key_t* k, void (*d)(void*)) { return __pthread_key_create(k, d); }

// Group B: stat family became real symbols in 2.33. Before that they were
// header inlines around __fxstat*/__xmknod, which still exist at ≤ 2.17.
extern "C" int __fxstat(int, int, struct stat*);
extern "C" int __fxstat64(int, int, struct stat64*);
extern "C" int __fxstatat(int, int, const char*, struct stat*, int);
extern "C" int __fxstatat64(int, int, const char*, struct stat64*, int);
extern "C" int __xmknod(int, const char*, mode_t, dev_t*);
BUN_SYMVER(__fxstat, BUN_GLIBC_BASE);
BUN_SYMVER(__fxstat64, BUN_GLIBC_BASE);
BUN_SYMVER(__fxstatat, BUN_GLIBC_2_4);
BUN_SYMVER(__fxstatat64, BUN_GLIBC_2_4);
BUN_SYMVER(__xmknod, BUN_GLIBC_BASE);

#ifndef _MKNOD_VER
#define _MKNOD_VER 0
#endif

extern "C" int __wrap_fstat(int fd, struct stat* st) { return __fxstat(_STAT_VER, fd, st); }
extern "C" int __wrap_fstat64(int fd, struct stat64* st) { return __fxstat64(_STAT_VER, fd, st); }
extern "C" int __wrap_fstatat(int dfd, const char* p, struct stat* st, int f) { return __fxstatat(_STAT_VER, dfd, p, st, f); }
extern "C" int __wrap_fstatat64(int dfd, const char* p, struct stat64* st, int f) { return __fxstatat64(_STAT_VER, dfd, p, st, f); }
extern "C" int __wrap_mknod(const char* p, mode_t m, dev_t d) { return __xmknod(_MKNOD_VER, p, m, &d); }

// Group C: thin syscall wrappers added in 2.27/2.28. Kernel has had the
// syscalls since 4.5 (copy_file_range), 3.17 (memfd_create), 4.11 (statx);
// callers (Rust std, bun.sys) already handle ENOSYS.
extern "C" int __wrap_statx(int dfd, const char* p, int flags, unsigned mask, struct statx* st)
{
    return syscall(SYS_statx, dfd, p, flags, mask, st);
}
extern "C" int __wrap_memfd_create(const char* name, unsigned flags)
{
    return syscall(SYS_memfd_create, name, flags);
}
extern "C" ssize_t __wrap_copy_file_range(int in, loff_t* ioff, int out, loff_t* ooff, size_t len, unsigned flags)
{
    return syscall(SYS_copy_file_range, in, ioff, out, ooff, len, flags);
}

// Group D: no older version exists. Forward via dlsym when present;
// otherwise return the documented "not supported" result so callers fall
// back (libgcc unwinder → dl_iterate_phdr; Rust spawn → fork/exec).
extern "C" int __wrap__dl_find_object(void* addr, void* result)
{
    using fn = int (*)(void*, void*);
    static fn real = reinterpret_cast<fn>(dlsym(RTLD_DEFAULT, "_dl_find_object"));
    return real ? real(addr, result) : -1;
}
extern "C" int __wrap_posix_spawn_file_actions_addchdir_np(posix_spawn_file_actions_t* fa, const char* path)
{
    using fn = int (*)(posix_spawn_file_actions_t*, const char*);
    static fn real = reinterpret_cast<fn>(dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_addchdir_np"));
    return real ? real(fa, path) : ENOSYS;
}

// __libc_start_main: 2.34 dropped the init/fini contract (crt1.o passes
// NULL). The 2.2.5 compat symbol on ≥ 2.34 ignores init and walks
// DT_INIT_ARRAY itself; on < 2.34 it calls init, so supply a walker that
// reproduces what the now-absent __libc_csu_init did.
extern "C" {
extern void (*__preinit_array_start[])(int, char**, char**) __attribute__((weak));
extern void (*__preinit_array_end[])(int, char**, char**) __attribute__((weak));
extern void (*__init_array_start[])(int, char**, char**) __attribute__((weak));
extern void (*__init_array_end[])(int, char**, char**) __attribute__((weak));
extern void _init() __attribute__((weak));
}
static int bun_libc_csu_init(int argc, char** argv, char** envp)
{
    for (auto f = __preinit_array_start; f < __preinit_array_end; ++f)
        (*f)(argc, argv, envp);
    if (&_init) _init();
    for (auto f = __init_array_start; f < __init_array_end; ++f)
        (*f)(argc, argv, envp);
    return 0;
}
BUN_SYMVER(__libc_start_main, BUN_GLIBC_BASE);
extern "C" int __libc_start_main(int (*)(int, char**, char**), int, char**, int (*)(int, char**, char**), void (*)(), void (*)(), void*);
extern "C" int __wrap___libc_start_main(int (*main)(int, char**, char**), int argc, char** argv,
    int (*init)(int, char**, char**), void (*fini)(), void (*rtld_fini)(), void* stack_end)
{
    return __libc_start_main(main, argc, argv, init ? init : bun_libc_csu_init, fini, rtld_fini, stack_end);
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

// Check if the stdlib declaration already has noexcept by looking at the header
#ifdef _LIBCPP___VERBOSE_ABORT
#if __has_include(<__verbose_abort>)
#include <__verbose_abort>
#endif
#endif

// Provide our implementation
// LLVM 20 used _LIBCPP_VERBOSE_ABORT_NOEXCEPT, LLVM 21+ uses _NOEXCEPT (always noexcept).
void std::__libcpp_verbose_abort(char const* format, ...) noexcept
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
