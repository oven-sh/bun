#include "uv-polyfills.h"

#include <string.h>

void __bun_throw_not_implemented(const char* symbol_name)
{
    CrashHandler__unsupportedUVFunction(symbol_name);
}

// The Windows versions of these functions are in src/runtime/napi/uv_windows.rs.
#if !OS(WINDOWS)

#include <pthread.h>
#include <unistd.h>
#include <stdlib.h>
#include <limits.h>

// libuv does the annoying thing of #undef'ing these
#include <errno.h>
#if EDOM > 0
#define UV__ERR(x) (-(x))
#else
#define UV__ERR(x) (x)
#endif

#if defined(PATH_MAX)
#define UV__PATH_MAX PATH_MAX
#else
#define UV__PATH_MAX 8192
#endif

// Internals

uint64_t uv__hrtime(uv_clocktype_t type);

#if defined(__linux__)
#include "uv-polyfills-linux.c"
#elif defined(__APPLE__)
#include "uv-polyfills-darwin.c"
#elif defined(__FreeBSD__)
#include "uv-polyfills-posix.c"
#elif defined(__CYGWIN__) || defined(__MSYS__) || defined(__HAIKU__) || defined(__QNX__) || defined(__GNU__)
#include "uv-polyfills-posix.c"
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

// On Unix a uv_os_fd_t is an int, so both conversions are no-ops.
UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return os_fd;
}

UV_EXTERN int uv_translate_sys_error(int sys_errno)
{
    return sys_errno <= 0 ? sys_errno : -sys_errno;
}

#endif

// The layouts and values that src/runtime/napi/uv.rs and uv_windows.rs assert too.
#if OS(WINDOWS)
#define UV_LAYOUT(on_unix, on_windows) (on_windows)
#else
#define UV_LAYOUT(on_unix, on_windows) (on_unix)
#endif
#define UV_ASSERT(condition) _Static_assert(condition, #condition)

UV_ASSERT(offsetof(uv_loop_t, data) == 0);
UV_ASSERT(offsetof(uv_handle_t, data) == 0);
UV_ASSERT(offsetof(uv_handle_t, loop) == 8);
UV_ASSERT(offsetof(uv_handle_t, type) == 16);
UV_ASSERT(offsetof(uv_handle_t, close_cb) == 24);
UV_ASSERT(offsetof(uv_handle_t, flags) == 88);
UV_ASSERT(sizeof(uv_handle_t) == 96);
UV_ASSERT(offsetof(uv_async_t, async_cb) == UV_LAYOUT(96, 208));
UV_ASSERT(sizeof(uv_async_t) == UV_LAYOUT(128, 224));
UV_ASSERT(offsetof(uv_idle_t, idle_cb) == UV_LAYOUT(96, 112));
UV_ASSERT(offsetof(uv_prepare_t, prepare_cb) == UV_LAYOUT(96, 112));
UV_ASSERT(offsetof(uv_check_t, check_cb) == UV_LAYOUT(96, 112));
UV_ASSERT(sizeof(uv_idle_t) == 120 && sizeof(uv_prepare_t) == 120 && sizeof(uv_check_t) == 120);
UV_ASSERT(offsetof(uv_timer_t, timer_cb) == UV_LAYOUT(96, 152));
UV_ASSERT(sizeof(uv_timer_t) == UV_LAYOUT(152, 160));
UV_ASSERT(offsetof(uv_req_t, data) == 0);
UV_ASSERT(offsetof(uv_req_t, type) == 8);
UV_ASSERT(sizeof(uv_req_t) == UV_LAYOUT(64, 112));
UV_ASSERT(offsetof(uv_work_t, loop) == sizeof(uv_req_t));
UV_ASSERT(offsetof(uv_work_t, work_cb) == sizeof(uv_req_t) + 8);
UV_ASSERT(offsetof(uv_work_t, after_work_cb) == sizeof(uv_req_t) + 16);
UV_ASSERT(sizeof(uv_work_t) == UV_LAYOUT(128, 176));
UV_ASSERT(UV_ASYNC == 1 && UV_CHECK == 2 && UV_IDLE == 6 && UV_PREPARE == 9 && UV_TIMER == 13);
UV_ASSERT(UV_WORK == 7);
#if OS(WINDOWS)
UV_ASSERT(offsetof(uv_loop_t, iocp) == 56);
UV_ASSERT(_Generic((uv_mutex_t*)NULL, CRITICAL_SECTION*: 1, default: 0));
UV_ASSERT(offsetof(uv_once_t, init_once) == 8 && sizeof(uv_once_t) == 16);
UV_ASSERT(UV_EINVAL == -4071 && UV_EBUSY == -4082 && UV_ECANCELED == -4081 && UV_ENOBUFS == -4060);
#endif

// These functions only need the headers, so they're copied from libuv
// (version.c, uv-common.c, uv-data-getter-setters.c). The functions that
// need a loop are in src/runtime/napi/uv.rs.

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

static char* unknown_error_r(int err, char* buf, size_t buflen)
{
    snprintf(buf, buflen, "Unknown system error %d", err);
    return buf;
}

// The caller can keep the pointer, so libuv documents that the copy is never freed.
static const char* unknown_error(int err)
{
    char buf[40];
    char* copy = strdup(unknown_error_r(err, buf, sizeof(buf)));
    return copy ? copy : "Unknown system error";
}

UV_EXTERN const char* uv_err_name(int err)
{
    switch (err) {
#define XX(name, _) \
    case UV_##name: \
        return #name;
        UV_ERRNO_MAP(XX)
#undef XX
    }
    return unknown_error(err);
}

UV_EXTERN char* uv_err_name_r(int err, char* buf, size_t buflen)
{
    switch (err) {
#define XX(name, _)                         \
    case UV_##name:                         \
        snprintf(buf, buflen, "%s", #name); \
        return buf;
        UV_ERRNO_MAP(XX)
#undef XX
    }
    return unknown_error_r(err, buf, buflen);
}

UV_EXTERN const char* uv_strerror(int err)
{
    switch (err) {
#define XX(name, message) \
    case UV_##name:       \
        return message;
        UV_ERRNO_MAP(XX)
#undef XX
    }
    return unknown_error(err);
}

UV_EXTERN char* uv_strerror_r(int err, char* buf, size_t buflen)
{
    switch (err) {
#define XX(name, message)                     \
    case UV_##name:                           \
        snprintf(buf, buflen, "%s", message); \
        return buf;
        UV_ERRNO_MAP(XX)
#undef XX
    }
    return unknown_error_r(err, buf, buflen);
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

// A uv_loop_t* points to a UvLoop (uv.rs), whose first field is also `data`.
UV_EXTERN void* uv_loop_get_data(const uv_loop_t* loop)
{
    return loop->data;
}

UV_EXTERN void uv_loop_set_data(uv_loop_t* loop, void* data)
{
    loop->data = data;
}
