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

// libuv's own definitions of the functions that need only the headers (its
// version.c, uv-common.c, uv-data-getter-setters.c, unix/core.c). The
// loop-backed functions are in src/runtime/napi/uv_posix.rs.

#define UV_STRINGIFY(v) UV_STRINGIFY_HELPER(v)
#define UV_STRINGIFY_HELPER(v) #v

#define UV_VERSION_STRING_BASE UV_STRINGIFY(UV_VERSION_MAJOR) "." UV_STRINGIFY(UV_VERSION_MINOR) "." UV_STRINGIFY(UV_VERSION_PATCH)

#if UV_VERSION_IS_RELEASE
#define UV_VERSION_STRING UV_VERSION_STRING_BASE
#else
#define UV_VERSION_STRING UV_VERSION_STRING_BASE "-" UV_VERSION_SUFFIX
#endif

// The headers' version, which is also what process.versions.uv reports.
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

// A uv_loop_t* is a UvLoop (uv_posix.rs); its first field is `data` too.
UV_EXTERN void* uv_loop_get_data(const uv_loop_t* loop)
{
    return loop->data;
}

UV_EXTERN void uv_loop_set_data(uv_loop_t* loop, void* data)
{
    loop->data = data;
}

// On unix a uv_os_fd_t is an int: both directions are the identity.
UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return os_fd;
}

#endif
