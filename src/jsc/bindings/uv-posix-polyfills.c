#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <pthread.h>
#include <sched.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

// libuv does the annoying thing of #undef'ing these
#include <errno.h>
#if EDOM > 0
#define UV__ERR(x) (-(x))
#else
#define UV__ERR(x) (x)
#endif

#define UV_STRINGIFY(v) UV_STRINGIFY_HELPER(v)
#define UV_STRINGIFY_HELPER(v) #v

#define UV_VERSION_STRING_BASE     \
    UV_STRINGIFY(UV_VERSION_MAJOR) \
    "." UV_STRINGIFY(UV_VERSION_MINOR) "." UV_STRINGIFY(UV_VERSION_PATCH)

#if UV_VERSION_IS_RELEASE
#define UV_VERSION_STRING UV_VERSION_STRING_BASE
#else
#define UV_VERSION_STRING UV_VERSION_STRING_BASE "-" UV_VERSION_SUFFIX
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

UV_EXTERN unsigned int uv_version(void)
{
    return UV_VERSION_HEX;
}

UV_EXTERN const char* uv_version_string(void)
{
    return UV_VERSION_STRING;
}

UV_EXTERN uv_buf_t uv_buf_init(char* base, unsigned int len)
{
    uv_buf_t buf;
    buf.base = base;
    buf.len = len;
    return buf;
}

#define UV_ERR_NAME_GEN(name, _) \
    case UV_##name:              \
        return #name;
UV_EXTERN const char* uv_err_name(int err)
{
    switch (err) {
        UV_ERRNO_MAP(UV_ERR_NAME_GEN)
    }
    return NULL;
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
    return "Unknown system error";
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
    return UV__ERR(sys_errno);
}

static const char* uv__handle_type_names[] = {
#define XX(uc, lc) [UV_##uc] = #lc,
    UV_HANDLE_TYPE_MAP(XX)
#undef XX
        [UV_FILE]
    = "file",
};

UV_EXTERN const char* uv_handle_type_name(uv_handle_type type)
{
    if ((int)type >= 0 && type < UV_HANDLE_TYPE_MAX)
        return uv__handle_type_names[type];
    return NULL;
}

static const size_t uv__handle_type_sizes[] = {
#define XX(uc, lc) [UV_##uc] = sizeof(uv_##lc##_t),
    UV_HANDLE_TYPE_MAP(XX)
#undef XX
};

UV_EXTERN size_t uv_handle_size(uv_handle_type type)
{
    if ((int)type >= 0 && type < UV_HANDLE_TYPE_MAX)
        return uv__handle_type_sizes[type];
    return (size_t)-1;
}

static const char* uv__req_type_names[] = {
#define XX(uc, lc) [UV_##uc] = #lc,
    UV_REQ_TYPE_MAP(XX)
#undef XX
};

UV_EXTERN const char* uv_req_type_name(uv_req_type type)
{
    if ((int)type >= 0 && type < UV_REQ_TYPE_MAX)
        return uv__req_type_names[type];
    return NULL;
}

static const size_t uv__req_type_sizes[] = {
#define XX(uc, lc) [UV_##uc] = sizeof(uv_##lc##_t),
    UV_REQ_TYPE_MAP(XX)
#undef XX
};

UV_EXTERN size_t uv_req_size(uv_req_type type)
{
    if ((int)type >= 0 && type < UV_REQ_TYPE_MAX)
        return uv__req_type_sizes[type];
    return (size_t)-1;
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
}

UV_EXTERN unsigned int uv_available_parallelism(void)
{
    long rc;

#if defined(__linux__)
    cpu_set_t set;
    memset(&set, 0, sizeof(set));
    if (0 == sched_getaffinity(0, sizeof(set), &set))
        rc = CPU_COUNT(&set);
    else
        rc = sysconf(_SC_NPROCESSORS_ONLN);
#else
    rc = sysconf(_SC_NPROCESSORS_ONLN);
#endif

    if (rc < 1)
        rc = 1;
    return (unsigned int)rc;
}

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
    case UV_CLOCK_MONOTONIC:
        r = clock_gettime(CLOCK_MONOTONIC, &t);
        break;
    case UV_CLOCK_REALTIME:
        r = clock_gettime(CLOCK_REALTIME, &t);
        break;
    default:
        return UV_EINVAL;
    }

    if (r)
        return UV__ERR(errno);

    ts->tv_sec = t.tv_sec;
    ts->tv_nsec = t.tv_nsec;
    return 0;
}

UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return os_fd;
}

UV_EXTERN char** uv_setup_args(int argc, char** argv)
{
    (void)argc;
    return argv;
}

UV_EXTERN void uv_library_shutdown(void)
{
}

#endif
