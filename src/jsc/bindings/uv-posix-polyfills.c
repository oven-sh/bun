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

// ---------------------------------------------------------------------------
// Everything below is copy-pasted from libuv at the commit recorded in
// libuv/README.md (the same commit the headers in libuv/ were copied from),
// with two adaptations:
// - uv__malloc/uv__calloc/uv__free are replaced with calloc/free
// - the glibc < 2.21 custom-semaphore workaround in uv_sem_* is omitted
//   (https://sourceware.org/bugzilla/show_bug.cgi?id=12674 was fixed in 2015;
//   every glibc Bun runs on is newer)
// Do not "improve" these: prebuilt N-API addons expect libuv's exact
// documented semantics.
// ---------------------------------------------------------------------------

#include <ifaddrs.h>
#include <limits.h>
#include <net/if.h>
#include <netinet/in.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>

#if defined(__linux__)
#include <linux/if_packet.h>
#else
#include <net/if_dl.h>
#endif

#if defined(PATH_MAX)
#define UV__PATH_MAX PATH_MAX
#else
#define UV__PATH_MAX 8192
#endif

#define UV__NANOSEC ((uint64_t)1e9)

#define UV__ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))

#define UV__EXCLUDE_IFPHYS 0
#define UV__EXCLUDE_IFADDR 1

#define UV__INET_ADDRSTRLEN 16
#define UV__INET6_ADDRSTRLEN 46

// Copied from libuv src/version.c
#define UV__STRINGIFY(v) UV__STRINGIFY_HELPER(v)
#define UV__STRINGIFY_HELPER(v) #v

#define UV__VERSION_STRING_BASE     \
    UV__STRINGIFY(UV_VERSION_MAJOR) \
    "." UV__STRINGIFY(UV_VERSION_MINOR) "." UV__STRINGIFY(UV_VERSION_PATCH)

#if UV_VERSION_IS_RELEASE
#define UV__VERSION_STRING UV__VERSION_STRING_BASE
#else
#define UV__VERSION_STRING UV__VERSION_STRING_BASE "-" UV_VERSION_SUFFIX
#endif

UV_EXTERN unsigned int uv_version(void)
{
    return UV_VERSION_HEX;
}

UV_EXTERN const char* uv_version_string(void)
{
    return UV__VERSION_STRING;
}

// Copied from libuv src/unix/core.c
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

// Copied from libuv src/unix/core.c
UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

// Copied from libuv src/unix/core.c
UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return os_fd;
}

// Copied from libuv src/unix/thread.c
UV_EXTERN uv_thread_t uv_thread_self(void)
{
    return pthread_self();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN int uv_thread_equal(const uv_thread_t* t1, const uv_thread_t* t2)
{
    return pthread_equal(*t1, *t2);
}

// Copied from libuv src/unix/thread.c
UV_EXTERN int uv_rwlock_init(uv_rwlock_t* rwlock)
{
    return UV__ERR(pthread_rwlock_init(rwlock, NULL));
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_rwlock_destroy(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_destroy(rwlock))
        abort();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_rwlock_rdlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_rdlock(rwlock))
        abort();
}

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_rwlock_rdunlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_unlock(rwlock))
        abort();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_rwlock_wrlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_wrlock(rwlock))
        abort();
}

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_rwlock_wrunlock(uv_rwlock_t* rwlock)
{
    if (pthread_rwlock_unlock(rwlock))
        abort();
}

#if defined(__APPLE__) && defined(__MACH__)

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_sem_destroy(uv_sem_t* sem)
{
    if (semaphore_destroy(mach_task_self(), *sem))
        abort();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_sem_post(uv_sem_t* sem)
{
    if (semaphore_signal(*sem))
        abort();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_sem_wait(uv_sem_t* sem)
{
    int r;

    do
        r = semaphore_wait(*sem);
    while (r == KERN_ABORTED);

    if (r != KERN_SUCCESS)
        abort();
}

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/unix/thread.c (uv__sem_init; see note at the top of
// this section about the omitted glibc < 2.21 workaround)
UV_EXTERN int uv_sem_init(uv_sem_t* sem, unsigned int value)
{
    if (sem_init(sem, 0, value))
        return UV__ERR(errno);
    return 0;
}

// Copied from libuv src/unix/thread.c (uv__sem_destroy)
UV_EXTERN void uv_sem_destroy(uv_sem_t* sem)
{
    if (sem_destroy(sem))
        abort();
}

// Copied from libuv src/unix/thread.c (uv__sem_post)
UV_EXTERN void uv_sem_post(uv_sem_t* sem)
{
    if (sem_post(sem))
        abort();
}

// Copied from libuv src/unix/thread.c (uv__sem_wait)
UV_EXTERN void uv_sem_wait(uv_sem_t* sem)
{
    int r;

    do
        r = sem_wait(sem);
    while (r == -1 && errno == EINTR);

    if (r)
        abort();
}

// Copied from libuv src/unix/thread.c (uv__sem_trywait)
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

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_cond_signal(uv_cond_t* cond)
{
    if (pthread_cond_signal(cond))
        abort();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_cond_broadcast(uv_cond_t* cond)
{
    if (pthread_cond_broadcast(cond))
        abort();
}

// Copied from libuv src/unix/thread.c
UV_EXTERN void uv_cond_wait(uv_cond_t* cond, uv_mutex_t* mutex)
{
#if defined(__APPLE__) && defined(__MACH__)
    int r;

    errno = 0;
    r = pthread_cond_wait(cond, mutex);

    /* Workaround for a bug in OS X at least up to 13.6
     * See https://github.com/libuv/libuv/issues/4165
     */
    if (r == EINVAL)
        if (errno == EBUSY)
            return;

    if (r)
        abort();
#else
    if (pthread_cond_wait(cond, mutex))
        abort();
#endif
}

// Copied from libuv src/unix/thread.c
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

// Copied from libuv src/inet.c (uv__strscpy from src/strscpy.c)
static ssize_t uv__strscpy(char* d, const char* s, size_t n)
{
    size_t i;

    for (i = 0; i < n; i++)
        if ('\0' == (d[i] = s[i]))
            return i > SSIZE_MAX ? UV_E2BIG : (ssize_t)i;

    if (i == 0)
        return 0;

    d[--i] = '\0';

    return UV_E2BIG;
}

// Copied from libuv src/inet.c
static int uv__inet_ntop4(const unsigned char* src, char* dst, size_t size)
{
    static const char fmt[] = "%u.%u.%u.%u";
    char tmp[UV__INET_ADDRSTRLEN];
    int l;

    l = snprintf(tmp, sizeof(tmp), fmt, src[0], src[1], src[2], src[3]);
    if (l <= 0 || (size_t)l >= size) {
        return UV_ENOSPC;
    }
    uv__strscpy(dst, tmp, size);
    return 0;
}

// Copied from libuv src/inet.c
static int uv__inet_ntop6(const unsigned char* src, char* dst, size_t size)
{
    /*
     * Note that int32_t and int16_t need only be "at least" large enough
     * to contain a value of the specified size.  On some systems, like
     * Crays, there is no such thing as an integer variable with 16 bits.
     * Keep this in mind if you think this function should have been coded
     * to use pointer overlays.  All the world's not a VAX.
     */
    char tmp[UV__INET6_ADDRSTRLEN], *tp;
    struct {
        int base, len;
    } best, cur;
    unsigned int words[sizeof(struct in6_addr) / sizeof(uint16_t)];
    int i;

    /*
     * Preprocess:
     *  Copy the input (bytewise) array into a wordwise array.
     *  Find the longest run of 0x00's in src[] for :: shorthanding.
     */
    memset(words, '\0', sizeof words);
    for (i = 0; i < (int)sizeof(struct in6_addr); i++)
        words[i / 2] |= (src[i] << ((1 - (i % 2)) << 3));
    best.base = -1;
    best.len = 0;
    cur.base = -1;
    cur.len = 0;
    for (i = 0; i < (int)UV__ARRAY_SIZE(words); i++) {
        if (words[i] == 0) {
            if (cur.base == -1)
                cur.base = i, cur.len = 1;
            else
                cur.len++;
        } else {
            if (cur.base != -1) {
                if (best.base == -1 || cur.len > best.len)
                    best = cur;
                cur.base = -1;
            }
        }
    }
    if (cur.base != -1) {
        if (best.base == -1 || cur.len > best.len)
            best = cur;
    }
    if (best.base != -1 && best.len < 2)
        best.base = -1;

    /*
     * Format the result.
     */
    tp = tmp;
    for (i = 0; i < (int)UV__ARRAY_SIZE(words); i++) {
        /* Are we inside the best run of 0x00's? */
        if (best.base != -1 && i >= best.base && i < (best.base + best.len)) {
            if (i == best.base)
                *tp++ = ':';
            continue;
        }
        /* Are we following an initial run of 0x00s or any real hex? */
        if (i != 0)
            *tp++ = ':';
        /* Is this address an encapsulated IPv4? */
        if (i == 6 && best.base == 0 && (best.len == 6 || (best.len == 7 && words[7] != 0x0001) || (best.len == 5 && words[5] == 0xffff))) {
            int err = uv__inet_ntop4(src + 12, tp, sizeof tmp - (tp - tmp));
            if (err)
                return err;
            tp += strlen(tp);
            break;
        }
        tp += snprintf(tp, sizeof tmp - (tp - tmp), "%x", words[i]);
    }
    /* Was it a trailing run of 0x00's? */
    if (best.base != -1 && (best.base + best.len) == UV__ARRAY_SIZE(words))
        *tp++ = ':';
    *tp++ = '\0';
    if ((size_t)(tp - tmp) > size)
        return UV_ENOSPC;
    uv__strscpy(dst, tmp, size);
    return 0;
}

// Copied from libuv src/inet.c
UV_EXTERN int uv_inet_ntop(int af, const void* src, char* dst, size_t size)
{
    switch (af) {
    case AF_INET:
        return (uv__inet_ntop4(src, dst, size));
    case AF_INET6:
        return (uv__inet_ntop6(src, dst, size));
    default:
        return UV_EAFNOSUPPORT;
    }
    /* NOTREACHED */
}

// Copied from libuv src/inet.c
static int uv__inet_pton4(const char* src, unsigned char* dst)
{
    static const char digits[] = "0123456789";
    int saw_digit, octets, ch;
    unsigned char tmp[sizeof(struct in_addr)], *tp;

    saw_digit = 0;
    octets = 0;
    *(tp = tmp) = 0;
    while ((ch = *src++) != '\0') {
        const char* pch;

        if ((pch = strchr(digits, ch)) != NULL) {
            unsigned int nw = *tp * 10 + (pch - digits);

            if (saw_digit && *tp == 0)
                return UV_EINVAL;
            if (nw > 255)
                return UV_EINVAL;
            *tp = nw;
            if (!saw_digit) {
                if (++octets > 4)
                    return UV_EINVAL;
                saw_digit = 1;
            }
        } else if (ch == '.' && saw_digit) {
            if (octets == 4)
                return UV_EINVAL;
            *++tp = 0;
            saw_digit = 0;
        } else
            return UV_EINVAL;
    }
    if (octets < 4)
        return UV_EINVAL;
    memcpy(dst, tmp, sizeof(struct in_addr));
    return 0;
}

// Copied from libuv src/inet.c
static int uv__inet_pton6(const char* src, unsigned char* dst)
{
    static const char xdigits_l[] = "0123456789abcdef",
                      xdigits_u[] = "0123456789ABCDEF";
    unsigned char tmp[sizeof(struct in6_addr)], *tp, *endp, *colonp;
    const char *xdigits, *curtok;
    int ch, seen_xdigits;
    unsigned int val;

    memset((tp = tmp), '\0', sizeof tmp);
    endp = tp + sizeof tmp;
    colonp = NULL;
    /* Leading :: requires some special handling. */
    if (*src == ':')
        if (*++src != ':')
            return UV_EINVAL;
    curtok = src;
    seen_xdigits = 0;
    val = 0;
    while ((ch = *src++) != '\0') {
        const char* pch;

        if ((pch = strchr((xdigits = xdigits_l), ch)) == NULL)
            pch = strchr((xdigits = xdigits_u), ch);
        if (pch != NULL) {
            val <<= 4;
            val |= (pch - xdigits);
            if (++seen_xdigits > 4)
                return UV_EINVAL;
            continue;
        }
        if (ch == ':') {
            curtok = src;
            if (!seen_xdigits) {
                if (colonp)
                    return UV_EINVAL;
                colonp = tp;
                continue;
            } else if (*src == '\0') {
                return UV_EINVAL;
            }
            if (tp + sizeof(uint16_t) > endp)
                return UV_EINVAL;
            *tp++ = (unsigned char)(val >> 8) & 0xff;
            *tp++ = (unsigned char)val & 0xff;
            seen_xdigits = 0;
            val = 0;
            continue;
        }
        if (ch == '.' && ((tp + sizeof(struct in_addr)) <= endp)) {
            int err = uv__inet_pton4(curtok, tp);
            if (err == 0) {
                tp += sizeof(struct in_addr);
                seen_xdigits = 0;
                break; /*%< '\0' was seen by inet_pton4(). */
            }
        }
        return UV_EINVAL;
    }
    if (seen_xdigits) {
        if (tp + sizeof(uint16_t) > endp)
            return UV_EINVAL;
        *tp++ = (unsigned char)(val >> 8) & 0xff;
        *tp++ = (unsigned char)val & 0xff;
    }
    if (colonp != NULL) {
        /*
         * Since some memmove()'s erroneously fail to handle
         * overlapping regions, we'll do the shift by hand.
         */
        const int n = tp - colonp;
        int i;

        if (tp == endp)
            return UV_EINVAL;
        for (i = 1; i <= n; i++) {
            endp[-i] = colonp[n - i];
            colonp[n - i] = 0;
        }
        tp = endp;
    }
    if (tp != endp)
        return UV_EINVAL;
    memcpy(dst, tmp, sizeof tmp);
    return 0;
}

// Copied from libuv src/inet.c
UV_EXTERN int uv_inet_pton(int af, const char* src, void* dst)
{
    if (src == NULL || dst == NULL)
        return UV_EINVAL;

    switch (af) {
    case AF_INET:
        return (uv__inet_pton4(src, dst));
    case AF_INET6: {
        int len;
        char tmp[UV__INET6_ADDRSTRLEN], *s, *p;
        s = (char*)src;
        p = strchr(src, '%');
        if (p != NULL) {
            s = tmp;
            len = p - src;
            if (len > UV__INET6_ADDRSTRLEN - 1)
                return UV_EINVAL;
            memcpy(s, src, len);
            s[len] = '\0';
        }
        return uv__inet_pton6(s, dst);
    }
    default:
        return UV_EAFNOSUPPORT;
    }
    /* NOTREACHED */
}

// Copied from libuv src/uv-common.c
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

// Copied from libuv src/uv-common.c
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

// Copied from libuv src/uv-common.c
UV_EXTERN int uv_ip4_name(const struct sockaddr_in* src, char* dst, size_t size)
{
    return uv_inet_ntop(AF_INET, &src->sin_addr, dst, size);
}

// Copied from libuv src/uv-common.c
UV_EXTERN int uv_ip6_name(const struct sockaddr_in6* src, char* dst, size_t size)
{
    return uv_inet_ntop(AF_INET6, &src->sin6_addr, dst, size);
}

// Copied from libuv src/uv-common.c
UV_EXTERN int uv_ip_name(const struct sockaddr* src, char* dst, size_t size)
{
    switch (src->sa_family) {
    case AF_INET:
        return uv_inet_ntop(AF_INET, &((struct sockaddr_in*)src)->sin_addr,
            dst, size);
    case AF_INET6:
        return uv_inet_ntop(AF_INET6, &((struct sockaddr_in6*)src)->sin6_addr,
            dst, size);
    default:
        return UV_EAFNOSUPPORT;
    }
}

#if defined(__linux__)

// Copied from libuv src/unix/linux.c
static int uv__ifaddr_exclude(struct ifaddrs* ent, int exclude_type)
{
    if (!((ent->ifa_flags & IFF_UP) && (ent->ifa_flags & IFF_RUNNING)))
        return 1;
    if (ent->ifa_addr == NULL)
        return 1;
    /*
     * On Linux getifaddrs returns information related to the raw underlying
     * devices. We're not interested in this information yet.
     */
    if (ent->ifa_addr->sa_family == PF_PACKET)
        return exclude_type;
    return !exclude_type;
}

// Copied from libuv src/unix/linux.c, plus the NULL ifa_netmask check from
// src/unix/bsd-ifaddrs.c (point-to-point interfaces may not have one)
UV_EXTERN int uv_interface_addresses(uv_interface_address_t** addresses, int* count)
{
    uv_interface_address_t* address;
    struct sockaddr_ll* sll;
    struct ifaddrs* addrs;
    struct ifaddrs* ent;
    size_t namelen;
    char* name;
    int i;

    *count = 0;
    *addresses = NULL;

    if (getifaddrs(&addrs))
        return UV__ERR(errno);

    /* Count the number of interfaces */
    namelen = 0;
    for (ent = addrs; ent != NULL; ent = ent->ifa_next) {
        if (uv__ifaddr_exclude(ent, UV__EXCLUDE_IFADDR))
            continue;

        namelen += strlen(ent->ifa_name) + 1;
        (*count)++;
    }

    if (*count == 0) {
        freeifaddrs(addrs);
        return 0;
    }

    /* Make sure the memory is initiallized to zero using calloc() */
    *addresses = calloc(1, *count * sizeof(**addresses) + namelen);
    if (*addresses == NULL) {
        freeifaddrs(addrs);
        return UV_ENOMEM;
    }

    name = (char*)&(*addresses)[*count];
    address = *addresses;

    for (ent = addrs; ent != NULL; ent = ent->ifa_next) {
        if (uv__ifaddr_exclude(ent, UV__EXCLUDE_IFADDR))
            continue;

        namelen = strlen(ent->ifa_name) + 1;
        address->name = memcpy(name, ent->ifa_name, namelen);
        name += namelen;

        if (ent->ifa_addr->sa_family == AF_INET6) {
            address->address.address6 = *((struct sockaddr_in6*)ent->ifa_addr);
        } else {
            address->address.address4 = *((struct sockaddr_in*)ent->ifa_addr);
        }

        if (ent->ifa_netmask == NULL) {
            memset(&address->netmask, 0, sizeof(address->netmask));
        } else if (ent->ifa_netmask->sa_family == AF_INET6) {
            address->netmask.netmask6 = *((struct sockaddr_in6*)ent->ifa_netmask);
        } else {
            address->netmask.netmask4 = *((struct sockaddr_in*)ent->ifa_netmask);
        }

        address->is_internal = !!(ent->ifa_flags & IFF_LOOPBACK);

        address++;
    }

    /* Fill in physical addresses for each interface */
    for (ent = addrs; ent != NULL; ent = ent->ifa_next) {
        if (uv__ifaddr_exclude(ent, UV__EXCLUDE_IFPHYS))
            continue;

        address = *addresses;

        for (i = 0; i < (*count); i++) {
            size_t namelen = strlen(ent->ifa_name);
            /* Alias interface share the same physical address */
            if (strncmp(address->name, ent->ifa_name, namelen) == 0 && (address->name[namelen] == 0 || address->name[namelen] == ':')) {
                sll = (struct sockaddr_ll*)ent->ifa_addr;
                memcpy(address->phys_addr, sll->sll_addr, sizeof(address->phys_addr));
            }
            address++;
        }
    }

    freeifaddrs(addrs);

    return 0;
}

#else /* !defined(__linux__) */

// Copied from libuv src/unix/bsd-ifaddrs.c
static int uv__ifaddr_exclude(struct ifaddrs* ent, int exclude_type)
{
    if (!((ent->ifa_flags & IFF_UP) && (ent->ifa_flags & IFF_RUNNING)))
        return 1;
    if (ent->ifa_addr == NULL)
        return 1;
    /*
     * If `exclude_type` is `UV__EXCLUDE_IFPHYS`, return whether `sa_family`
     * equals `AF_LINK`. Otherwise, the result depends on the operating
     * system with `AF_LINK` or `PF_INET`.
     */
    if (exclude_type == UV__EXCLUDE_IFPHYS)
        return (ent->ifa_addr->sa_family != AF_LINK);
    /*
     * On BSD getifaddrs returns information related to the raw underlying
     * devices. We're not interested in this information.
     */
    if (ent->ifa_addr->sa_family == AF_LINK)
        return 1;
    return 0;
}

// Copied from libuv src/unix/bsd-ifaddrs.c
UV_EXTERN int uv_interface_addresses(uv_interface_address_t** addresses, int* count)
{
    uv_interface_address_t* address;
    struct ifaddrs* addrs;
    struct ifaddrs* ent;
    size_t namelen;
    char* name;

    *count = 0;
    *addresses = NULL;

    if (getifaddrs(&addrs) != 0)
        return UV__ERR(errno);

    /* Count the number of interfaces */
    namelen = 0;
    for (ent = addrs; ent != NULL; ent = ent->ifa_next) {
        if (uv__ifaddr_exclude(ent, UV__EXCLUDE_IFADDR))
            continue;
        namelen += strlen(ent->ifa_name) + 1;
        (*count)++;
    }

    if (*count == 0) {
        freeifaddrs(addrs);
        return 0;
    }

    /* Make sure the memory is initiallized to zero using calloc() */
    *addresses = calloc(1, *count * sizeof(**addresses) + namelen);
    if (*addresses == NULL) {
        freeifaddrs(addrs);
        return UV_ENOMEM;
    }

    name = (char*)&(*addresses)[*count];
    address = *addresses;

    for (ent = addrs; ent != NULL; ent = ent->ifa_next) {
        if (uv__ifaddr_exclude(ent, UV__EXCLUDE_IFADDR))
            continue;

        namelen = strlen(ent->ifa_name) + 1;
        address->name = memcpy(name, ent->ifa_name, namelen);
        name += namelen;

        if (ent->ifa_addr->sa_family == AF_INET6) {
            address->address.address6 = *((struct sockaddr_in6*)ent->ifa_addr);
        } else {
            address->address.address4 = *((struct sockaddr_in*)ent->ifa_addr);
        }

        if (ent->ifa_netmask == NULL) {
            memset(&address->netmask, 0, sizeof(address->netmask));
        } else if (ent->ifa_netmask->sa_family == AF_INET6) {
            address->netmask.netmask6 = *((struct sockaddr_in6*)ent->ifa_netmask);
        } else {
            address->netmask.netmask4 = *((struct sockaddr_in*)ent->ifa_netmask);
        }

        address->is_internal = !!(ent->ifa_flags & IFF_LOOPBACK);

        address++;
    }

    /* Fill in physical addresses for each interface */
    for (ent = addrs; ent != NULL; ent = ent->ifa_next) {
        int i;

        if (uv__ifaddr_exclude(ent, UV__EXCLUDE_IFPHYS))
            continue;

        address = *addresses;

        for (i = 0; i < *count; i++) {
            if (strcmp(address->name, ent->ifa_name) == 0) {
                struct sockaddr_dl* sa_addr;
                sa_addr = (struct sockaddr_dl*)(ent->ifa_addr);
                memcpy(address->phys_addr, LLADDR(sa_addr), sizeof(address->phys_addr));
            }
            address++;
        }
    }

    freeifaddrs(addrs);

    return 0;
}

#endif /* defined(__linux__) */

// Copied from libuv src/unix/linux.c
UV_EXTERN void uv_free_interface_addresses(uv_interface_address_t* addresses,
    int count)
{
    free(addresses);
}

#endif
