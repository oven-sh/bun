#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <pthread.h>
#include <unistd.h>
#include <stdlib.h>

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

// Copy-pasted from libuv (src/unix/thread.c), with stack size tuning omitted.
// The libuv version rounds a requested stack size up to a page boundary and
// clamps it to a minimum; here we fall through to pthread defaults when no
// size is requested and just honor the requested size otherwise.
UV_EXTERN int uv_thread_create_ex(uv_thread_t* tid,
    const uv_thread_options_t* params,
    uv_thread_cb entry,
    void* arg)
{
    int err;
    pthread_attr_t* attr;
    pthread_attr_t attr_storage;
    size_t stack_size;

    /* Used to squelch a -Wcast-function-type warning. */
    union {
        void (*in)(void*);
        void* (*out)(void*);
    } f;

    stack_size = (params != NULL && (params->flags & UV_THREAD_HAS_STACK_SIZE))
        ? params->stack_size
        : 0;

    attr = NULL;
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
