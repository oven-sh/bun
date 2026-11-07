#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <pthread.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <stdio.h>
#include <arpa/inet.h>
#include <net/if.h>
#include <netinet/in.h>

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

// Copy-pasted from libuv (uv-common.c)
UV_EXTERN uv_buf_t uv_buf_init(char* base, unsigned int len)
{
    uv_buf_t buf;
    buf.base = base;
    buf.len = len;
    return buf;
}

static const char* uv__unknown_err_code(int err)
{
    char buf[32];
    char* copy;

    snprintf(buf, sizeof(buf), "Unknown system error %d", err);
    copy = strdup(buf);

    return copy != NULL ? copy : "Unknown system error";
}

#define UV_ERR_NAME_GEN_R(name, _)            \
    case UV_##name:                           \
        snprintf(buf, buflen, "%s", #name);   \
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

#define UV_STRERROR_GEN_R(name, msg)        \
    case UV_##name:                         \
        snprintf(buf, buflen, "%s", msg);   \
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

// libuv has its own parser and formatter (inet.c). The system's take the same
// input and produce the same output, so these map their results to libuv's codes.
UV_EXTERN int uv_inet_ntop(int af, const void* src, char* dst, size_t size)
{
    if (af != AF_INET && af != AF_INET6)
        return UV_EAFNOSUPPORT;
    if (inet_ntop(af, src, dst, size) == NULL)
        return UV__ERR(errno);
    return 0;
}

UV_EXTERN int uv_inet_pton(int af, const char* src, void* dst)
{
    if (src == NULL || dst == NULL)
        return UV_EINVAL;
    if (af == AF_INET)
        return inet_pton(AF_INET, src, dst) == 1 ? 0 : UV_EINVAL;
    if (af != AF_INET6)
        return UV_EAFNOSUPPORT;
    // Like libuv, ignore a zone index ("fe80::1%eth0").
    char tmp[sizeof("ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255")];
    const char* percent = strchr(src, '%');
    if (percent != NULL) {
        size_t len = (size_t)(percent - src);
        if (len >= sizeof(tmp))
            return UV_EINVAL;
        memcpy(tmp, src, len);
        tmp[len] = '\0';
        src = tmp;
    }
    return inet_pton(AF_INET6, src, dst) == 1 ? 0 : UV_EINVAL;
}

// Copy-pasted from libuv (uv-common.c)
UV_EXTERN int uv_ip4_addr(const char* ip, int port, struct sockaddr_in* addr)
{
    memset(addr, 0, sizeof(*addr));
    addr->sin_family = AF_INET;
    addr->sin_port = htons(port);
#ifdef SIN6_LEN
    addr->sin_len = sizeof(*addr);
#endif
    return uv_inet_pton(AF_INET, ip, &(addr->sin_addr.s_addr));
}

UV_EXTERN int uv_ip6_addr(const char* ip, int port, struct sockaddr_in6* addr)
{
    char address_part[40];
    size_t address_part_size;
    const char* zone_index;

    memset(addr, 0, sizeof(*addr));
    addr->sin6_family = AF_INET6;
    addr->sin6_port = htons(port);
#ifdef SIN6_LEN
    addr->sin6_len = sizeof(*addr);
#endif

    zone_index = strchr(ip, '%');
    if (zone_index != NULL) {
        address_part_size = zone_index - ip;
        if (address_part_size >= sizeof(address_part))
            address_part_size = sizeof(address_part) - 1;

        memcpy(address_part, ip, address_part_size);
        address_part[address_part_size] = '\0';
        ip = address_part;

        zone_index++; /* skip '%' */
        /* NOTE: unknown interface (id=0) is silently ignored */
        addr->sin6_scope_id = if_nametoindex(zone_index);
    }

    return uv_inet_pton(AF_INET6, ip, &addr->sin6_addr);
}

UV_EXTERN int uv_ip4_name(const struct sockaddr_in* src, char* dst, size_t size)
{
    return uv_inet_ntop(AF_INET, &src->sin_addr, dst, size);
}

UV_EXTERN int uv_ip6_name(const struct sockaddr_in6* src, char* dst, size_t size)
{
    return uv_inet_ntop(AF_INET6, &src->sin6_addr, dst, size);
}

UV_EXTERN int uv_ip_name(const struct sockaddr* src, char* dst, size_t size)
{
    switch (src->sa_family) {
    case AF_INET:
        return uv_inet_ntop(AF_INET, &((struct sockaddr_in*)src)->sin_addr, dst, size);
    case AF_INET6:
        return uv_inet_ntop(AF_INET6, &((struct sockaddr_in6*)src)->sin6_addr, dst, size);
    default:
        return UV_EAFNOSUPPORT;
    }
}

#endif
