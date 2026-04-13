#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <limits.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <unistd.h>

// libuv does the annoying thing of #undef'ing these
#include <errno.h>
#if EDOM > 0
#define UV__ERR(x) (-(x))
#else
#define UV__ERR(x) (x)
#endif

void __bun_throw_not_implemented(const char* symbol_name)
{
    CrashHandler__unsupportedUVFunction(symbol_name);
}

// Internals

uint64_t uv__hrtime(uv_clocktype_t type);

#if defined(__linux__)
#include "uv-posix-polyfills-linux.c"
// #elif defined(__MVS__)
// #include "uv/os390.h"
// #elif defined(__PASE__) /* __PASE__ and _AIX are both defined on IBM i */
// #include "uv/posix.h" /* IBM i needs uv/posix.h, not uv/aix.h */
// #elif defined(_AIX)
// #include "uv/aix.h"
// #elif defined(__sun)
// #include "uv/sunos.h"
#elif defined(__APPLE__)
#include "uv-posix-polyfills-darwin.c"
#elif defined(__FreeBSD__)
#include "uv-posix-polyfills-posix.c"
#elif defined(__CYGWIN__) || defined(__MSYS__) || defined(__HAIKU__) || defined(__QNX__) || defined(__GNU__)
#include "uv-posix-polyfills-posix.c"
#endif

uv_pid_t uv_os_getpid()
{
    return getpid();
}

uv_pid_t uv_os_getppid()
{
    return getppid();
}

UV_EXTERN void uv_once(uv_once_t* guard, void (*callback)(void))
{
    if (pthread_once(guard, callback))
        abort();
}

UV_EXTERN uint64_t uv_hrtime(void)
{
    return uv__hrtime(UV_CLOCK_PRECISE);
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_destroy(uv_mutex_t* mutex)
{
    if (pthread_mutex_destroy(mutex))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_init(uv_mutex_t* mutex)
{
    pthread_mutexattr_t attr;
    int err;

    if (pthread_mutexattr_init(&attr))
        abort();

    if (pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_ERRORCHECK))
        abort();

    err = pthread_mutex_init(mutex, &attr);

    if (pthread_mutexattr_destroy(&attr))
        abort();

    return UV__ERR(err);
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_init_recursive(uv_mutex_t* mutex)
{
    pthread_mutexattr_t attr;
    int err;

    if (pthread_mutexattr_init(&attr))
        abort();

    if (pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE))
        abort();

    err = pthread_mutex_init(mutex, &attr);

    if (pthread_mutexattr_destroy(&attr))
        abort();

    return UV__ERR(err);
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_lock(uv_mutex_t* mutex)
{
    if (pthread_mutex_lock(mutex))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_trylock(uv_mutex_t* mutex)
{
    int err;

    err = pthread_mutex_trylock(mutex);
    if (err) {
        if (err != EBUSY && err != EAGAIN)
            abort();
        return UV_EBUSY;
    }

    return 0;
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_unlock(uv_mutex_t* mutex)
{
    if (pthread_mutex_unlock(mutex))
        abort();
}

// Copy-pasted from libuv (src/unix/thread.c)
UV_EXTERN uv_thread_t uv_thread_self(void)
{
    return pthread_self();
}

// Copy-pasted from libuv (src/unix/thread.c)
UV_EXTERN int uv_thread_equal(const uv_thread_t* t1, const uv_thread_t* t2)
{
    return pthread_equal(*t1, *t2);
}

// Copy-pasted from libuv (src/unix/thread.c)
UV_EXTERN int uv_thread_join(uv_thread_t* tid)
{
    return UV__ERR(pthread_join(*tid, NULL));
}

// Copy-pasted from libuv (src/unix/thread.c)
UV_EXTERN int uv_thread_detach(uv_thread_t* tid)
{
    return UV__ERR(pthread_detach(*tid));
}

/* Copy-pasted from libuv (src/unix/thread.c): minimum stack size a thread
 * may be created with. A new thread needs to allocate, among other things,
 * a TLS block AND pthread's internal bookkeeping. The exact size is
 * arch-dependent. */
static size_t uv__min_stack_size(void)
{
    static const size_t min = 8192;

#ifdef PTHREAD_STACK_MIN /* Not defined on NetBSD. */
    if (min < (size_t)PTHREAD_STACK_MIN)
        return PTHREAD_STACK_MIN;
#endif

    return min;
}

/* Copy-pasted from libuv (src/unix/thread.c): on Linux, threads created by
 * musl have a much smaller stack than threads created by glibc (80 vs.
 * 2048 or 4096 kB). Follow glibc for consistency. */
static size_t uv__default_stack_size(void)
{
#if !defined(__linux__)
    return 0;
#elif defined(__PPC__) || defined(__ppc__) || defined(__powerpc__)
    return 4 << 20; /* glibc default. */
#else
    return 2 << 20; /* glibc default. */
#endif
}

/* Copy-pasted from libuv (src/unix/thread.c): on MacOS, threads other than
 * the main thread are created with a reduced stack size by default. Adjust
 * to RLIMIT_STACK aligned to the page size. */
static size_t uv__thread_stack_size(void)
{
#if defined(__APPLE__) || defined(__linux__)
    struct rlimit lim;

    /* getrlimit() can fail on some aarch64 systems due to a glibc bug
     * where the system call wrapper invokes the wrong system call. Don't
     * treat that as fatal, just use the default stack size instead. */
    if (getrlimit(RLIMIT_STACK, &lim))
        return uv__default_stack_size();

    if (lim.rlim_cur == RLIM_INFINITY)
        return uv__default_stack_size();

    /* pthread_attr_setstacksize() expects page-aligned values. */
    lim.rlim_cur -= lim.rlim_cur % (rlim_t)getpagesize();

    if (lim.rlim_cur >= (rlim_t)uv__min_stack_size())
        return lim.rlim_cur;
#endif

    return uv__default_stack_size();
}

// Copy-pasted from libuv (src/unix/thread.c). The page-rounding and
// min-stack-size clamping is what makes the two abort() calls below safe:
// without them, pthread_attr_setstacksize could legitimately fail with
// EINVAL on a caller-supplied stack_size that is too small or not
// page-aligned, and abort() would be wrong.
UV_EXTERN int uv_thread_create_ex(uv_thread_t* tid,
    const uv_thread_options_t* params,
    uv_thread_cb entry,
    void* arg)
{
    int err;
    pthread_attr_t* attr;
    pthread_attr_t attr_storage;
    size_t pagesize;
    size_t stack_size;
    size_t min_stack_size;

    /* Used to squelch a -Wcast-function-type warning. */
    union {
        void (*in)(void*);
        void* (*out)(void*);
    } f;

    stack_size = (params != NULL && (params->flags & UV_THREAD_HAS_STACK_SIZE))
        ? params->stack_size
        : 0;

    attr = NULL;
    if (stack_size == 0) {
        stack_size = uv__thread_stack_size();
    } else {
        pagesize = (size_t)getpagesize();
        /* Round up to the nearest page boundary. */
        stack_size = (stack_size + pagesize - 1) & ~(pagesize - 1);
        min_stack_size = uv__min_stack_size();
        if (stack_size < min_stack_size)
            stack_size = min_stack_size;
    }

    if (stack_size > 0) {
        attr = &attr_storage;

        if (pthread_attr_init(attr))
            abort();

        if (pthread_attr_setstacksize(attr, stack_size))
            abort();
    }

    f.in = entry;
    err = pthread_create(tid, attr, f.out, arg);

    if (attr != NULL)
        pthread_attr_destroy(attr);

    return UV__ERR(err);
}

// Copy-pasted from libuv (src/unix/thread.c)
UV_EXTERN int uv_thread_create(uv_thread_t* tid, uv_thread_cb entry, void* arg)
{
    uv_thread_options_t params;
    params.flags = UV_THREAD_NO_FLAGS;
    return uv_thread_create_ex(tid, &params, entry, arg);
}

#endif
