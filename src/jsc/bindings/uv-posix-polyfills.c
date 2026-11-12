#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <pthread.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <time.h>

#if defined(__APPLE__) && defined(__MACH__)
#include <mach/mach.h>
#else
#include <semaphore.h>
#endif

// libuv does the annoying thing of #undef'ing these
#include <errno.h>
#if EDOM > 0
#define UV__ERR(x) (-(x))
#else
#define UV__ERR(x) (x)
#endif

#define UV__NANOSEC ((uint64_t)1e9)

#if defined(PATH_MAX)
#define UV__PATH_MAX PATH_MAX
#else
#define UV__PATH_MAX 8192
#endif

void __bun_throw_not_implemented(const char* symbol_name)
{
    CrashHandler__unsupportedUVFunction(symbol_name);
}

// Internals

uint64_t uv__hrtime(uv_clocktype_t type);

#if defined(__linux__)
#include "uv-posix-polyfills-linux.c"
#elif defined(__APPLE__)
#include "uv-posix-polyfills-darwin.c"
#elif defined(__FreeBSD__)
#include "uv-posix-polyfills-posix.c"
#elif defined(__CYGWIN__) || defined(__MSYS__) || defined(__HAIKU__) || defined(__QNX__) || defined(__GNU__)
#include "uv-posix-polyfills-posix.c"
#endif

// Copy-pasted from libuv
UV_EXTERN int uv_cwd(char* buffer, size_t* size)
{
    char scratch[1 + UV__PATH_MAX];

    if (buffer == NULL || size == NULL || *size == 0)
        return UV_EINVAL;

    /* Try to read directly into the user's buffer first... */
    if (getcwd(buffer, *size) != NULL)
        goto fixup;

    if (errno != ERANGE)
        return UV__ERR(errno);

    /* ...or into scratch space if the user's buffer is too small
     * so we can report how much space to provide on the next try.
     */
    if (getcwd(scratch, sizeof(scratch)) == NULL)
        return UV__ERR(errno);

    buffer = scratch;

fixup:

    *size = strlen(buffer);

    if (*size > 1 && buffer[*size - 1] == '/') {
        *size -= 1;
        buffer[*size] = '\0';
    }

    if (buffer == scratch) {
        *size += 1;
        return UV_ENOBUFS;
    }

    return 0;
}

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

// Copy-pasted from libuv
UV_EXTERN int uv_rwlock_init(uv_rwlock_t* rwlock)
{
    return UV__ERR(pthread_rwlock_init(rwlock, NULL));
}

// Copy-pasted from libuv
UV_EXTERN void uv_rwlock_destroy(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_destroy(rwlock))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_rwlock_rdlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_rdlock(rwlock))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_rwlock_rdunlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_unlock(rwlock))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_rwlock_tryrdlock(uv_rwlock_t* rwlock)
{
    int err;

    err = pthread_rwlock_tryrdlock(rwlock);
    if (err) {
        if (err != EBUSY && err != EAGAIN)
            abort();
        return UV_EBUSY;
    }

    return 0;
}

// Copy-pasted from libuv
UV_EXTERN void uv_rwlock_wrlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_wrlock(rwlock))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_rwlock_wrunlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_unlock(rwlock))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_rwlock_trywrlock(uv_rwlock_t* rwlock)
{
    int err;

    err = pthread_rwlock_trywrlock(rwlock);
    if (err) {
        if (err != EBUSY && err != EAGAIN)
            abort();
        return UV_EBUSY;
    }

    return 0;
}

#if defined(__APPLE__) && defined(__MACH__)

// Copy-pasted from libuv
UV_EXTERN int uv_sem_init(uv_sem_t* sem, unsigned int value)
{
    kern_return_t err;

    err = semaphore_create(mach_task_self(), sem, SYNC_POLICY_FIFO, value);
    if (err == KERN_SUCCESS)
        return 0;
    if (err == KERN_INVALID_ARGUMENT)
        return UV_EINVAL;
    if (err == KERN_RESOURCE_SHORTAGE)
        return UV_ENOMEM;

    abort();
    return UV_EINVAL; /* Satisfy the compiler. */
}

// Copy-pasted from libuv
UV_EXTERN void uv_sem_destroy(uv_sem_t* sem)
{
    if (semaphore_destroy(mach_task_self(), *sem))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_sem_post(uv_sem_t* sem)
{
    if (semaphore_signal(*sem))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_sem_wait(uv_sem_t* sem)
{
    int r;

    do
        r = semaphore_wait(*sem);
    while (r == KERN_ABORTED);

    if (r != KERN_SUCCESS)
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_sem_trywait(uv_sem_t* sem)
{
    mach_timespec_t interval;
    kern_return_t err;

    interval.tv_sec = 0;
    interval.tv_nsec = 0;

    err = semaphore_timedwait(*sem, interval);
    if (err == KERN_SUCCESS)
        return 0;
    if (err == KERN_OPERATION_TIMED_OUT)
        return UV_EAGAIN;

    abort();
    return UV_EINVAL; /* Satisfy the compiler. */
}

#else /* !(defined(__APPLE__) && defined(__MACH__)) */

// Copy-pasted from libuv (the sem_t path; the custom semaphore for glibc
// older than 2.21 is not needed, bun requires a newer glibc)
UV_EXTERN int uv_sem_init(uv_sem_t* sem, unsigned int value)
{
    if (sem_init(sem, 0, value))
        return UV__ERR(errno);
    return 0;
}

// Copy-pasted from libuv
UV_EXTERN void uv_sem_destroy(uv_sem_t* sem)
{
    if (sem_destroy(sem))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_sem_post(uv_sem_t* sem)
{
    if (sem_post(sem))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_sem_wait(uv_sem_t* sem)
{
    int r;

    do
        r = sem_wait(sem);
    while (r == -1 && errno == EINTR);

    if (r)
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_sem_trywait(uv_sem_t* sem)
{
    int r;

    do
        r = sem_trywait(sem);
    while (r == -1 && errno == EINTR);

    if (r) {
        if (errno == EAGAIN)
            return UV_EAGAIN;
        abort();
    }

    return 0;
}

#endif /* defined(__APPLE__) && defined(__MACH__) */

// Copy-pasted from libuv
UV_EXTERN int uv_cond_init(uv_cond_t* cond)
{
#if defined(__APPLE__) && defined(__MACH__)
    return UV__ERR(pthread_cond_init(cond, NULL));
#else
    pthread_condattr_t attr;
    int err;

    err = pthread_condattr_init(&attr);
    if (err)
        return UV__ERR(err);

    err = pthread_condattr_setclock(&attr, CLOCK_MONOTONIC);
    if (err)
        goto error2;

    err = pthread_cond_init(cond, &attr);
    if (err)
        goto error2;

    err = pthread_condattr_destroy(&attr);
    if (err)
        goto error;

    return 0;

error:
    pthread_cond_destroy(cond);
error2:
    pthread_condattr_destroy(&attr);
    return UV__ERR(err);
#endif
}

// Copy-pasted from libuv
UV_EXTERN void uv_cond_destroy(uv_cond_t* cond)
{
#if defined(__APPLE__) && defined(__MACH__)
    /* It has been reported that destroying condition variables that have been
     * signalled but not waited on can sometimes result in application crashes.
     * See https://codereview.chromium.org/1323293005.
     */
    pthread_mutex_t mutex;
    struct timespec ts;
    int err;

    if (pthread_mutex_init(&mutex, NULL))
        abort();

    if (pthread_mutex_lock(&mutex))
        abort();

    ts.tv_sec = 0;
    ts.tv_nsec = 1;

    err = pthread_cond_timedwait_relative_np(cond, &mutex, &ts);
    if (err != 0 && err != ETIMEDOUT)
        abort();

    if (pthread_mutex_unlock(&mutex))
        abort();

    if (pthread_mutex_destroy(&mutex))
        abort();
#endif /* defined(__APPLE__) && defined(__MACH__) */

    if (pthread_cond_destroy(cond))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_cond_signal(uv_cond_t* cond)
{
    if (pthread_cond_signal(cond))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_cond_broadcast(uv_cond_t* cond)
{
    if (pthread_cond_broadcast(cond))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void uv_cond_wait(uv_cond_t* cond, uv_mutex_t* mutex)
{
    if (pthread_cond_wait(cond, mutex))
        abort();
}

// Copy-pasted from libuv. `timeout` is relative, in nanoseconds.
UV_EXTERN int uv_cond_timedwait(uv_cond_t* cond, uv_mutex_t* mutex, uint64_t timeout)
{
    int r;
    struct timespec ts;

#if defined(__APPLE__) && defined(__MACH__)
    ts.tv_sec = timeout / UV__NANOSEC;
    ts.tv_nsec = timeout % UV__NANOSEC;
    r = pthread_cond_timedwait_relative_np(cond, mutex, &ts);
#else
    timeout += uv__hrtime(UV_CLOCK_PRECISE);
    ts.tv_sec = timeout / UV__NANOSEC;
    ts.tv_nsec = timeout % UV__NANOSEC;
    r = pthread_cond_timedwait(cond, mutex, &ts);
#endif

    if (r == 0)
        return 0;

    if (r == ETIMEDOUT)
        return UV_ETIMEDOUT;

    abort();
    return UV_EINVAL; /* Satisfy the compiler. */
}

#if defined(__APPLE__) || !defined(PTHREAD_BARRIER_SERIAL_THREAD)

// Copy-pasted from libuv. The guard matches uv_barrier_t's in uv/unix.h.
UV_EXTERN int uv_barrier_init(uv_barrier_t* barrier, unsigned int count)
{
    struct _uv_barrier* b;
    int rc;

    if (barrier == NULL || count == 0)
        return UV_EINVAL;

    b = malloc(sizeof(*b));
    if (b == NULL)
        return UV_ENOMEM;

    b->in = 0;
    b->out = 0;
    b->threshold = count;

    rc = uv_mutex_init(&b->mutex);
    if (rc != 0)
        goto error2;

    rc = uv_cond_init(&b->cond);
    if (rc != 0)
        goto error;

    barrier->b = b;
    return 0;

error:
    uv_mutex_destroy(&b->mutex);
error2:
    free(b);
    return rc;
}

// Copy-pasted from libuv
UV_EXTERN int uv_barrier_wait(uv_barrier_t* barrier)
{
    struct _uv_barrier* b;
    int last;

    if (barrier == NULL || barrier->b == NULL)
        return UV_EINVAL;

    b = barrier->b;
    uv_mutex_lock(&b->mutex);

    if (++b->in == b->threshold) {
        b->in = 0;
        b->out = b->threshold;
        uv_cond_signal(&b->cond);
    } else {
        do
            uv_cond_wait(&b->cond, &b->mutex);
        while (b->in != 0);
    }

    last = (--b->out == 0);
    if (!last)
        uv_cond_signal(&b->cond); /* Not needed for last thread. */

    uv_mutex_unlock(&b->mutex);
    return last;
}

// Copy-pasted from libuv
UV_EXTERN void uv_barrier_destroy(uv_barrier_t* barrier)
{
    struct _uv_barrier* b;

    b = barrier->b;
    uv_mutex_lock(&b->mutex);

    if (b->in != 0 || b->out != 0)
        abort();

    uv_mutex_unlock(&b->mutex);
    uv_mutex_destroy(&b->mutex);
    uv_cond_destroy(&b->cond);

    free(b);
    barrier->b = NULL;
}

#else

// Copy-pasted from libuv
UV_EXTERN int uv_barrier_init(uv_barrier_t* barrier, unsigned int count)
{
    return UV__ERR(pthread_barrier_init(barrier, NULL, count));
}

// Copy-pasted from libuv
UV_EXTERN int uv_barrier_wait(uv_barrier_t* barrier)
{
    int rc;

    rc = pthread_barrier_wait(barrier);
    if (rc != 0)
        if (rc != PTHREAD_BARRIER_SERIAL_THREAD)
            abort();

    return rc == PTHREAD_BARRIER_SERIAL_THREAD;
}

// Copy-pasted from libuv
UV_EXTERN void uv_barrier_destroy(uv_barrier_t* barrier)
{
    if (pthread_barrier_destroy(barrier))
        abort();
}

#endif

// Copy-pasted from libuv
UV_EXTERN int uv_key_create(uv_key_t* key)
{
    return UV__ERR(pthread_key_create(key, NULL));
}

// Copy-pasted from libuv
UV_EXTERN void uv_key_delete(uv_key_t* key)
{
    if (pthread_key_delete(*key))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN void* uv_key_get(uv_key_t* key)
{
    return pthread_getspecific(*key);
}

// Copy-pasted from libuv
UV_EXTERN void uv_key_set(uv_key_t* key, void* value)
{
    if (pthread_setspecific(*key, value))
        abort();
}

// These functions only need the headers, so they're copied from libuv
// (version.c, uv-common.c, uv-data-getter-setters.c, unix/core.c). The
// functions that need a loop are in src/runtime/napi/uv_posix.rs.

#define UV_STRINGIFY(v) UV_STRINGIFY_HELPER(v)
#define UV_STRINGIFY_HELPER(v) #v

#define UV_VERSION_STRING_BASE UV_STRINGIFY(UV_VERSION_MAJOR) "." UV_STRINGIFY(UV_VERSION_MINOR) "." UV_STRINGIFY(UV_VERSION_PATCH)

#if UV_VERSION_IS_RELEASE
#define UV_VERSION_STRING UV_VERSION_STRING_BASE
#else
#define UV_VERSION_STRING UV_VERSION_STRING_BASE "-" UV_VERSION_SUFFIX
#endif

UV_EXTERN unsigned int uv_version(void)
{
    return UV_VERSION_HEX;
}

UV_EXTERN const char* uv_version_string(void)
{
    return UV_VERSION_STRING;
}

UV_EXTERN size_t uv_handle_size(uv_handle_type type)
{
    switch (type) {
#define XX(uc, lc) \
    case UV_##uc:  \
        return sizeof(uv_##lc##_t);
        UV_HANDLE_TYPE_MAP(XX)
#undef XX
    default:
        return (size_t)-1;
    }
}

UV_EXTERN size_t uv_req_size(uv_req_type type)
{
    switch (type) {
#define XX(uc, lc) \
    case UV_##uc:  \
        return sizeof(uv_##lc##_t);
        UV_REQ_TYPE_MAP(XX)
#undef XX
    default:
        return (size_t)-1;
    }
}

UV_EXTERN const char* uv_handle_type_name(uv_handle_type type)
{
    switch (type) {
#define XX(uc, lc) \
    case UV_##uc:  \
        return #lc;
        UV_HANDLE_TYPE_MAP(XX)
#undef XX
    case UV_FILE:
        return "file";
    case UV_HANDLE_TYPE_MAX:
    case UV_UNKNOWN_HANDLE:
        return NULL;
    }
    return NULL;
}

UV_EXTERN const char* uv_req_type_name(uv_req_type type)
{
    switch (type) {
#define XX(uc, lc) \
    case UV_##uc:  \
        return #lc;
        UV_REQ_TYPE_MAP(XX)
#undef XX
    case UV_REQ_TYPE_MAX:
    case UV_UNKNOWN_REQ:
    default: /* UV_REQ_TYPE_PRIVATE */
        break;
    }
    return NULL;
}

UV_EXTERN uv_handle_type uv_handle_get_type(const uv_handle_t* handle)
{
    return handle->type;
}

UV_EXTERN void* uv_handle_get_data(const uv_handle_t* handle)
{
    return handle->data;
}

UV_EXTERN uv_loop_t* uv_handle_get_loop(const uv_handle_t* handle)
{
    return handle->loop;
}

UV_EXTERN void uv_handle_set_data(uv_handle_t* handle, void* data)
{
    handle->data = data;
}

UV_EXTERN uv_req_type uv_req_get_type(const uv_req_t* req)
{
    return req->type;
}

UV_EXTERN void* uv_req_get_data(const uv_req_t* req)
{
    return req->data;
}

UV_EXTERN void uv_req_set_data(uv_req_t* req, void* data)
{
    req->data = data;
}

// A uv_loop_t* points to a UvLoop (uv_posix.rs), whose first field is also `data`.
UV_EXTERN void* uv_loop_get_data(const uv_loop_t* loop)
{
    return loop->data;
}

UV_EXTERN void uv_loop_set_data(uv_loop_t* loop, void* data)
{
    loop->data = data;
}

// On Unix a uv_os_fd_t is an int, so both conversions are no-ops.
UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return os_fd;
}

#endif
