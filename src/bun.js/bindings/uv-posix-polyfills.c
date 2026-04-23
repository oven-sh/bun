#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)

#include <assert.h>
#include <netdb.h>
#include <pthread.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
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

//
// Version
//

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

//
// Buffer
//

UV_EXTERN uv_buf_t uv_buf_init(char* base, unsigned int len)
{
    uv_buf_t buf;
    buf.base = base;
    buf.len = len;
    return buf;
}

//
// Errors
//

static const char* uv__unknown_err_code(int err)
{
    char buf[32];
    char* copy;

    snprintf(buf, sizeof(buf), "Unknown system error %d", err);
    copy = strdup(buf);

    return copy != NULL ? copy : "Unknown system error";
}

#define UV_ERR_NAME_GEN(name, _) \
    case UV_##name:              \
        return #name;
UV_EXTERN const char* uv_err_name(int err)
{
    switch (err) {
        UV_ERRNO_MAP(UV_ERR_NAME_GEN)
    }
    return uv__unknown_err_code(err);
}
#undef UV_ERR_NAME_GEN

#define UV_ERR_NAME_GEN_R(name, _)          \
    case UV_##name:                         \
        snprintf(buf, buflen, "%s", #name); \
        break;
UV_EXTERN char* uv_err_name_r(int err, char* buf, size_t buflen)
{
    switch (err) {
        UV_ERRNO_MAP(UV_ERR_NAME_GEN_R)
    default:
        snprintf(buf, buflen, "Unknown system error %d", err);
    }
    return buf;
}
#undef UV_ERR_NAME_GEN_R

#define UV_STRERROR_GEN(name, msg) \
    case UV_##name:                \
        return msg;
UV_EXTERN const char* uv_strerror(int err)
{
    switch (err) {
        UV_ERRNO_MAP(UV_STRERROR_GEN)
    }
    return uv__unknown_err_code(err);
}
#undef UV_STRERROR_GEN

#define UV_STRERROR_GEN_R(name, msg)      \
    case UV_##name:                       \
        snprintf(buf, buflen, "%s", msg); \
        break;
UV_EXTERN char* uv_strerror_r(int err, char* buf, size_t buflen)
{
    switch (err) {
        UV_ERRNO_MAP(UV_STRERROR_GEN_R)
    default:
        snprintf(buf, buflen, "Unknown system error %d", err);
    }
    return buf;
}
#undef UV_STRERROR_GEN_R

UV_EXTERN int uv_translate_sys_error(int sys_errno)
{
    /* If < 0 then it's already a libuv error. */
    return sys_errno <= 0 ? sys_errno : -sys_errno;
}

//
// OS file handle (identity on posix)
//

UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return os_fd;
}

//
// Time
//

UV_EXTERN int uv_gettimeofday(uv_timeval64_t* tv)
{
    struct timeval time;

    if (tv == NULL)
        return UV_EINVAL;

    if (gettimeofday(&time, NULL) != 0)
        return UV__ERR(errno);

    tv->tv_sec = (int64_t)time.tv_sec;
    tv->tv_usec = (int32_t)time.tv_usec;
    return 0;
}

UV_EXTERN int uv_clock_gettime(uv_clock_id clock_id, uv_timespec64_t* ts)
{
    struct timespec t;
    int r;

    if (ts == NULL)
        return UV_EFAULT;

    switch (clock_id) {
    default:
        return UV_EINVAL;
    case UV_CLOCK_MONOTONIC:
        r = clock_gettime(CLOCK_MONOTONIC, &t);
        break;
    case UV_CLOCK_REALTIME:
        r = clock_gettime(CLOCK_REALTIME, &t);
        break;
    }

    if (r)
        return UV__ERR(errno);

    ts->tv_sec = t.tv_sec;
    ts->tv_nsec = t.tv_nsec;

    return 0;
}

UV_EXTERN void uv_sleep(unsigned int msec)
{
    struct timespec timeout;
    int rc;

    timeout.tv_sec = msec / 1000;
    timeout.tv_nsec = (msec % 1000) * 1000 * 1000;

    do
        rc = nanosleep(&timeout, &timeout);
    while (rc == -1 && errno == EINTR);

    assert(rc == 0);
}

//
// Syscall wrappers
//

UV_EXTERN int uv_chdir(const char* dir)
{
    if (chdir(dir))
        return UV__ERR(errno);

    return 0;
}

UV_EXTERN int uv_kill(int pid, int signum)
{
    if (kill(pid, signum))
        return UV__ERR(errno);

    return 0;
}

UV_EXTERN int uv_os_setenv(const char* name, const char* value)
{
    if (name == NULL || value == NULL)
        return UV_EINVAL;

    if (setenv(name, value, 1) != 0)
        return UV__ERR(errno);

    return 0;
}

UV_EXTERN int uv_os_unsetenv(const char* name)
{
    if (name == NULL)
        return UV_EINVAL;

    if (unsetenv(name) != 0)
        return UV__ERR(errno);

    return 0;
}

UV_EXTERN void uv_freeaddrinfo(struct addrinfo* ai)
{
    if (ai)
        freeaddrinfo(ai);
}

//
// Thread-local storage
//

UV_EXTERN int uv_key_create(uv_key_t* key)
{
    return UV__ERR(pthread_key_create(key, NULL));
}

UV_EXTERN void uv_key_delete(uv_key_t* key)
{
    if (pthread_key_delete(*key))
        abort();
}

UV_EXTERN void* uv_key_get(uv_key_t* key)
{
    return pthread_getspecific(*key);
}

UV_EXTERN void uv_key_set(uv_key_t* key, void* value)
{
    if (pthread_setspecific(*key, value))
        abort();
}

//
// Read-write locks
//

UV_EXTERN int uv_rwlock_init(uv_rwlock_t* rwlock)
{
    return UV__ERR(pthread_rwlock_init(rwlock, NULL));
}

UV_EXTERN void uv_rwlock_destroy(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_destroy(rwlock))
        abort();
}

UV_EXTERN void uv_rwlock_rdlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_rdlock(rwlock))
        abort();
}

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

UV_EXTERN void uv_rwlock_rdunlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_unlock(rwlock))
        abort();
}

UV_EXTERN void uv_rwlock_wrlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_wrlock(rwlock))
        abort();
}

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

UV_EXTERN void uv_rwlock_wrunlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_unlock(rwlock))
        abort();
}

//
// Threads
//

UV_EXTERN uv_thread_t uv_thread_self(void)
{
    return pthread_self();
}

UV_EXTERN int uv_thread_join(uv_thread_t* tid)
{
    return UV__ERR(pthread_join(*tid, NULL));
}

UV_EXTERN int uv_thread_equal(const uv_thread_t* t1, const uv_thread_t* t2)
{
    return pthread_equal(*t1, *t2);
}

//
// Handle / req / loop helpers
//

UV_EXTERN size_t uv_loop_size(void)
{
    return sizeof(uv_loop_t);
}

#define XX(uc, lc) \
    case UV_##uc:  \
        return sizeof(uv_##lc##_t);

UV_EXTERN size_t uv_handle_size(uv_handle_type type)
{
    switch (type) {
        UV_HANDLE_TYPE_MAP(XX)
    default:
        return -1;
    }
}

UV_EXTERN size_t uv_req_size(uv_req_type type)
{
    switch (type) {
        UV_REQ_TYPE_MAP(XX)
    default:
        return -1;
    }
}

#undef XX

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

UV_EXTERN void* uv_loop_get_data(const uv_loop_t* loop)
{
    return loop->data;
}

UV_EXTERN void uv_loop_set_data(uv_loop_t* loop, void* data)
{
    loop->data = data;
}

#endif
