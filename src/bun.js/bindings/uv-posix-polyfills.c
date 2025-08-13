#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)

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
// #elif defined(__DragonFly__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
// #include "uv/bsd.h"
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

// Implementation of uv_queue_work using pthreads
// This bridges libuv's work queue API to basic thread pool functionality
// Required for Go runtime initialization in native modules

struct uv_work_data {
    uv_work_t* req;
    uv_work_cb work_cb;
    uv_after_work_cb after_work_cb;
    uv_loop_t* loop;
    int status;
};

static void* uv_work_thread(void* arg) {
    struct uv_work_data* data = (struct uv_work_data*)arg;
    
    // Execute the work callback on this thread
    if (data->work_cb && data->req) {
        data->work_cb(data->req);
    }
    
    // Note: The after_work_cb should ideally be called on the main thread
    // For now, we call it immediately after the work completes
    // This is sufficient for Go runtime initialization needs
    if (data->after_work_cb && data->req) {
        data->after_work_cb(data->req, data->status);
    }
    
    free(data);
    return NULL;
}

UV_EXTERN int uv_queue_work(uv_loop_t* loop,
                            uv_work_t* req,
                            uv_work_cb work_cb,
                            uv_after_work_cb after_work_cb) {
    if (!req || !work_cb || !after_work_cb) {
        return UV_EINVAL;
    }
    
    // Set up the loop and callbacks in the request
    req->loop = loop;
    req->work_cb = work_cb;
    req->after_work_cb = after_work_cb;
    
    // Create work data for the thread
    struct uv_work_data* data = malloc(sizeof(struct uv_work_data));
    if (!data) {
        return UV_ENOMEM;
    }
    
    data->req = req;
    data->work_cb = work_cb;
    data->after_work_cb = after_work_cb;
    data->loop = loop;
    data->status = 0; // Success by default
    
    // Create a detached thread to run the work
    pthread_t thread;
    pthread_attr_t attr;
    
    if (pthread_attr_init(&attr) != 0) {
        free(data);
        return UV_EIO;
    }
    
    if (pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED) != 0) {
        pthread_attr_destroy(&attr);
        free(data);
        return UV_EIO;
    }
    
    if (pthread_create(&thread, &attr, uv_work_thread, data) != 0) {
        pthread_attr_destroy(&attr);
        free(data);
        return UV_EIO;
    }
    
    pthread_attr_destroy(&attr);
    return 0; // Success
}

#endif
