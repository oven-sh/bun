#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <pthread.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <poll.h>

#if defined(__linux__)
#include <sys/epoll.h>
#include <sys/eventfd.h>
#elif defined(__APPLE__)
#include <sys/event.h>
#include <sys/time.h>
#endif

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

// ═══════════════════════════════════════════════════════════════════
// uv_default_loop — Singleton loop instance for NAPI modules
// ═══════════════════════════════════════════════════════════════════

static uv_loop_t bun__default_loop;
static pthread_once_t bun__default_loop_once = PTHREAD_ONCE_INIT;

static void bun__default_loop_init_fn(void)
{
    memset(&bun__default_loop, 0, sizeof(uv_loop_t));
}

UV_EXTERN uv_loop_t* uv_default_loop(void)
{
    pthread_once(&bun__default_loop_once, bun__default_loop_init_fn);
    return &bun__default_loop;
}

// ═══════════════════════════════════════════════════════════════════
// uv_strerror — libuv error code to string
// ═══════════════════════════════════════════════════════════════════

UV_EXTERN const char* uv_strerror(int err)
{
    switch (err) {
    case 0:                return "success";
    case UV_E2BIG:         return "argument list too long";
    case UV_EACCES:        return "permission denied";
    case UV_EADDRINUSE:    return "address already in use";
    case UV_EADDRNOTAVAIL: return "address not available";
    case UV_EAFNOSUPPORT:  return "address family not supported";
    case UV_EAGAIN:        return "resource temporarily unavailable";
    case UV_EAI_ADDRFAMILY:return "address family not supported";
    case UV_EAI_AGAIN:     return "temporary failure";
    case UV_EAI_BADFLAGS:  return "bad ai_flags value";
    case UV_EAI_BADHINTS:  return "bad hints";
    case UV_EAI_CANCELED:  return "request canceled";
    case UV_EAI_FAIL:      return "permanent failure";
    case UV_EAI_FAMILY:    return "ai_family not supported";
    case UV_EAI_MEMORY:    return "out of memory";
    case UV_EAI_NODATA:    return "no address";
    case UV_EAI_NONAME:    return "unknown node or service";
    case UV_EAI_OVERFLOW:  return "argument buffer overflow";
    case UV_EAI_PROTOCOL:  return "resolved protocol is unknown";
    case UV_EAI_SERVICE:   return "service not available for socket type";
    case UV_EAI_SOCKTYPE:  return "socket type not supported";
    case UV_EALREADY:      return "connection already in progress";
    case UV_EBADF:         return "bad file descriptor";
    case UV_EBUSY:         return "resource busy or locked";
    case UV_ECANCELED:     return "operation canceled";
    case UV_ECHARSET:      return "invalid Unicode character";
    case UV_ECONNABORTED:  return "software caused connection abort";
    case UV_ECONNREFUSED:  return "connection refused";
    case UV_ECONNRESET:    return "connection reset by peer";
    case UV_EDESTADDRREQ:  return "destination address required";
    case UV_EEXIST:        return "file already exists";
    case UV_EFAULT:        return "bad address in system call argument";
    case UV_EFBIG:         return "file too large";
    case UV_EHOSTUNREACH:  return "host is unreachable";
    case UV_EINTR:         return "interrupted system call";
    case UV_EINVAL:        return "invalid argument";
    case UV_EIO:           return "i/o error";
    case UV_EISCONN:       return "socket is already connected";
    case UV_EISDIR:        return "illegal operation on a directory";
    case UV_ELOOP:         return "too many symbolic links encountered";
    case UV_EMFILE:        return "too many open files";
    case UV_EMSGSIZE:      return "message too long";
    case UV_ENAMETOOLONG:  return "name too long";
    case UV_ENETDOWN:      return "network is down";
    case UV_ENETUNREACH:   return "network is unreachable";
    case UV_ENFILE:        return "file table overflow";
    case UV_ENOBUFS:       return "no buffer space available";
    case UV_ENODEV:        return "no such device";
    case UV_ENOENT:        return "no such file or directory";
    case UV_ENOMEM:        return "not enough memory";
    case UV_ENONET:        return "machine is not on the network";
    case UV_ENOPROTOOPT:   return "protocol not available";
    case UV_ENOSPC:        return "no space left on device";
    case UV_ENOSYS:        return "function not implemented";
    case UV_ENOTCONN:      return "socket is not connected";
    case UV_ENOTDIR:       return "not a directory";
    case UV_ENOTEMPTY:     return "directory not empty";
    case UV_ENOTSOCK:      return "socket operation on non-socket";
    case UV_ENOTSUP:       return "operation not supported on socket";
    case UV_EPERM:         return "operation not permitted";
    case UV_EPIPE:         return "broken pipe";
    case UV_EPROTO:        return "protocol error";
    case UV_EPROTONOSUPPORT: return "protocol not supported";
    case UV_EPROTOTYPE:    return "protocol wrong type for socket";
    case UV_ERANGE:        return "result too large";
    case UV_EROFS:         return "read-only file system";
    case UV_ESHUTDOWN:     return "cannot send after transport endpoint shutdown";
    case UV_ESPIPE:        return "invalid seek";
    case UV_ESRCH:         return "no such process";
    case UV_ETIMEDOUT:     return "connection timed out";
    case UV_ETXTBSY:       return "text file is busy";
    case UV_EXDEV:         return "cross-device link not permitted";
    case UV_UNKNOWN:       return "unknown error";
    case UV_EOF:           return "end of file";
    case UV_ENXIO:         return "no such device or address";
    case UV_EMLINK:        return "too many links";
    default:               return "unknown error";
    }
}

// ═══════════════════════════════════════════════════════════════════
// Poll thread infrastructure
//
// A single background thread monitors all active poll/async handles
// using epoll (Linux) or kqueue (macOS). When events fire, callbacks
// are dispatched directly on the poll thread.
//
// NOTE: In canonical libuv, callbacks run on the loop thread via
// uv_run(). Bun does not run a traditional uv_run() event loop, so
// there is no loop thread to dispatch to. Deferring callbacks to a
// pending queue would cause them to never fire. NAPI consumers
// (e.g. @serialport/bindings-cpp) already use napi_threadsafe_function
// for the C→JS boundary, making poll-thread dispatch safe in practice.
// ═══════════════════════════════════════════════════════════════════

#define BUN_UV_MAX_POLL_HANDLES 64

typedef struct {
    uv_poll_t* handle;
    int fd;
    int events;        // UV_READABLE | UV_WRITABLE | UV_DISCONNECT
    uv_poll_cb cb;
    int active;
} bun_poll_entry_t;

typedef struct {
    uv_async_t* handle;
    uv_async_cb cb;
    int active;
    int wakeup_fd;     // eventfd (Linux) or pipe read end (macOS)
    int wakeup_wfd;    // pipe write end (macOS only, -1 on Linux)
} bun_async_entry_t;

static bun_poll_entry_t bun__poll_entries[BUN_UV_MAX_POLL_HANDLES];
static bun_async_entry_t bun__async_entries[BUN_UV_MAX_POLL_HANDLES];
static int bun__poll_count = 0;
static int bun__async_count = 0;
static pthread_mutex_t bun__poll_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_t bun__poll_thread;
static int bun__poll_thread_running = 0;
static int bun__poll_wakeup_fd = -1;   // to wake the poll thread on changes
static int bun__poll_wakeup_wfd = -1;  // write end (macOS pipe)

#if defined(__linux__)
static int bun__epoll_fd = -1;
#elif defined(__APPLE__)
static int bun__kqueue_fd = -1;
#endif

static void bun__poll_wakeup(void)
{
    if (bun__poll_wakeup_fd < 0) return;
#if defined(__linux__)
    uint64_t val = 1;
    (void)write(bun__poll_wakeup_fd, &val, sizeof(val));
#elif defined(__APPLE__)
    char c = 1;
    (void)write(bun__poll_wakeup_wfd, &c, 1);
#endif
}

static void bun__poll_drain_wakeup(void)
{
#if defined(__linux__)
    uint64_t val;
    (void)read(bun__poll_wakeup_fd, &val, sizeof(val));
#elif defined(__APPLE__)
    char buf[64];
    while (read(bun__poll_wakeup_fd, buf, sizeof(buf)) > 0) {}
#endif
}

// ── Platform-specific poll thread ────────────────────────────────

#if defined(__linux__)

static void bun__ensure_epoll(void)
{
    if (bun__epoll_fd >= 0) return;
    bun__epoll_fd = epoll_create1(EPOLL_CLOEXEC);
    if (bun__epoll_fd < 0) abort();

    // Register wakeup eventfd
    bun__poll_wakeup_fd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    if (bun__poll_wakeup_fd < 0) abort();

    struct epoll_event ev = { .events = EPOLLIN, .data.fd = bun__poll_wakeup_fd };
    if (epoll_ctl(bun__epoll_fd, EPOLL_CTL_ADD, bun__poll_wakeup_fd, &ev) < 0) abort();
}

static int bun__uv_to_epoll(int uv_events)
{
    int ep = 0;
    if (uv_events & UV_READABLE)   ep |= EPOLLIN;
    if (uv_events & UV_WRITABLE)   ep |= EPOLLOUT;
    if (uv_events & UV_DISCONNECT) ep |= EPOLLRDHUP;
    return ep;
}

static int bun__epoll_to_uv(int ep_events)
{
    int uv = 0;
    if (ep_events & EPOLLIN)    uv |= UV_READABLE;
    if (ep_events & EPOLLOUT)   uv |= UV_WRITABLE;
    if (ep_events & (EPOLLRDHUP | EPOLLHUP | EPOLLERR)) uv |= UV_DISCONNECT;
    return uv;
}

static void* bun__poll_thread_fn(void* arg)
{
    (void)arg;
    struct epoll_event events[BUN_UV_MAX_POLL_HANDLES + 1];

    while (bun__poll_thread_running) {
        int n = epoll_wait(bun__epoll_fd, events,
                           BUN_UV_MAX_POLL_HANDLES + 1, 100 /*ms*/);
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }

        pthread_mutex_lock(&bun__poll_mutex);

        for (int i = 0; i < n; i++) {
            int fd = events[i].data.fd;

            // Wakeup fd — just drain it
            if (fd == bun__poll_wakeup_fd) {
                bun__poll_drain_wakeup();
                continue;
            }

            // Find matching poll entry
            for (int j = 0; j < bun__poll_count; j++) {
                if (bun__poll_entries[j].active && bun__poll_entries[j].fd == fd) {
                    int uv_events = bun__epoll_to_uv(events[i].events);
                    uv_poll_cb cb = bun__poll_entries[j].cb;
                    uv_poll_t* handle = bun__poll_entries[j].handle;
                    pthread_mutex_unlock(&bun__poll_mutex);
                    if (cb) cb(handle, 0, uv_events);
                    pthread_mutex_lock(&bun__poll_mutex);
                    break;
                }
            }

            // Find matching async entry
            for (int j = 0; j < bun__async_count; j++) {
                if (bun__async_entries[j].active && bun__async_entries[j].wakeup_fd == fd) {
                    uint64_t val;
                    (void)read(fd, &val, sizeof(val));
                    uv_async_cb cb = bun__async_entries[j].cb;
                    uv_async_t* handle = bun__async_entries[j].handle;
                    pthread_mutex_unlock(&bun__poll_mutex);
                    if (cb) cb(handle);
                    pthread_mutex_lock(&bun__poll_mutex);
                    break;
                }
            }
        }

        pthread_mutex_unlock(&bun__poll_mutex);
    }

    return NULL;
}

#elif defined(__APPLE__)

static void bun__ensure_kqueue(void)
{
    if (bun__kqueue_fd >= 0) return;
    bun__kqueue_fd = kqueue();
    if (bun__kqueue_fd < 0) abort();

    // Create wakeup pipe
    int pipefd[2];
    if (pipe(pipefd) < 0) abort();
    fcntl(pipefd[0], F_SETFL, O_NONBLOCK);
    fcntl(pipefd[1], F_SETFL, O_NONBLOCK);
    fcntl(pipefd[0], F_SETFD, FD_CLOEXEC);
    fcntl(pipefd[1], F_SETFD, FD_CLOEXEC);
    bun__poll_wakeup_fd = pipefd[0];
    bun__poll_wakeup_wfd = pipefd[1];

    struct kevent kev;
    EV_SET(&kev, bun__poll_wakeup_fd, EVFILT_READ, EV_ADD, 0, 0, NULL);
    if (kevent(bun__kqueue_fd, &kev, 1, NULL, 0, NULL) < 0) abort();
}

static void* bun__poll_thread_fn(void* arg)
{
    (void)arg;
    struct kevent events[BUN_UV_MAX_POLL_HANDLES + 1];
    struct timespec timeout = { .tv_sec = 0, .tv_nsec = 100000000 }; // 100ms

    while (bun__poll_thread_running) {
        int n = kevent(bun__kqueue_fd, NULL, 0, events,
                       BUN_UV_MAX_POLL_HANDLES + 1, &timeout);
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }

        pthread_mutex_lock(&bun__poll_mutex);

        for (int i = 0; i < n; i++) {
            int fd = (int)(uintptr_t)events[i].ident;

            // Wakeup pipe — drain
            if (fd == bun__poll_wakeup_fd) {
                bun__poll_drain_wakeup();
                continue;
            }

            // Determine uv events from kqueue filter
            int uv_events = 0;
            if (events[i].filter == EVFILT_READ)  uv_events |= UV_READABLE;
            if (events[i].filter == EVFILT_WRITE) uv_events |= UV_WRITABLE;
            if (events[i].flags & EV_EOF)         uv_events |= UV_DISCONNECT;

            // Find matching poll entry
            for (int j = 0; j < bun__poll_count; j++) {
                if (bun__poll_entries[j].active && bun__poll_entries[j].fd == fd) {
                    uv_poll_cb cb = bun__poll_entries[j].cb;
                    uv_poll_t* handle = bun__poll_entries[j].handle;
                    pthread_mutex_unlock(&bun__poll_mutex);
                    if (cb) cb(handle, 0, uv_events);
                    pthread_mutex_lock(&bun__poll_mutex);
                    break;
                }
            }

            // Find matching async entry
            for (int j = 0; j < bun__async_count; j++) {
                if (bun__async_entries[j].active && bun__async_entries[j].wakeup_fd == fd) {
                    char buf[64];
                    while (read(fd, buf, sizeof(buf)) > 0) {}
                    uv_async_cb cb = bun__async_entries[j].cb;
                    uv_async_t* handle = bun__async_entries[j].handle;
                    pthread_mutex_unlock(&bun__poll_mutex);
                    if (cb) cb(handle);
                    pthread_mutex_lock(&bun__poll_mutex);
                    break;
                }
            }
        }

        pthread_mutex_unlock(&bun__poll_mutex);
    }

    return NULL;
}

#endif // __APPLE__

static pthread_once_t bun__poll_thread_once = PTHREAD_ONCE_INIT;
static int bun__poll_thread_init_err = 0;

static void bun__poll_thread_init(void)
{
#if defined(__linux__)
    bun__ensure_epoll();
#elif defined(__APPLE__)
    bun__ensure_kqueue();
#endif

    bun__poll_thread_running = 1;

    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    int err = pthread_create(&bun__poll_thread, &attr, bun__poll_thread_fn, NULL);
    pthread_attr_destroy(&attr);

    if (err != 0) {
        bun__poll_thread_running = 0;
        bun__poll_thread_init_err = UV__ERR(err);
        fprintf(stderr, "bun: failed to create poll thread: %s\n", strerror(err));
    }
}

static int bun__ensure_poll_thread(void)
{
    pthread_once(&bun__poll_thread_once, bun__poll_thread_init);
    if (!bun__poll_thread_running)
        return bun__poll_thread_init_err != 0 ? bun__poll_thread_init_err : UV_EIO;
    return 0;
}

// ═══════════════════════════════════════════════════════════════════
// uv_poll_init / uv_poll_init_socket
// ═══════════════════════════════════════════════════════════════════

UV_EXTERN int uv_poll_init(uv_loop_t* loop, uv_poll_t* handle, int fd)
{
    if (!handle) return UV_EINVAL;
    memset(handle, 0, sizeof(uv_poll_t));
    handle->loop = loop;
    handle->type = UV_POLL;

    // Store fd — on POSIX uv_poll_t we use the .io_watcher.fd pattern,
    // but since we own the struct layout, we store it in our entry table.
    // Use handle->data temporarily to pass fd to poll_start.
    // We'll find the fd from our entry table via handle pointer.

    pthread_mutex_lock(&bun__poll_mutex);
    if (bun__poll_count >= BUN_UV_MAX_POLL_HANDLES) {
        pthread_mutex_unlock(&bun__poll_mutex);
        return UV_ENOMEM;
    }
    int idx = bun__poll_count++;
    bun__poll_entries[idx].handle = handle;
    bun__poll_entries[idx].fd = fd;
    bun__poll_entries[idx].events = 0;
    bun__poll_entries[idx].cb = NULL;
    bun__poll_entries[idx].active = 0;
    pthread_mutex_unlock(&bun__poll_mutex);

    return 0;
}

UV_EXTERN int uv_poll_init_socket(uv_loop_t* loop, uv_poll_t* handle,
    uv_os_sock_t socket)
{
    return uv_poll_init(loop, handle, (int)socket);
}

// ═══════════════════════════════════════════════════════════════════
// uv_poll_start / uv_poll_stop
// ═══════════════════════════════════════════════════════════════════

UV_EXTERN int uv_poll_start(uv_poll_t* handle, int events, uv_poll_cb cb)
{
    if (!handle || !cb) return UV_EINVAL;

    int thread_err = bun__ensure_poll_thread();
    if (thread_err != 0) return thread_err;

    pthread_mutex_lock(&bun__poll_mutex);

    // Find entry for this handle
    bun_poll_entry_t* entry = NULL;
    for (int i = 0; i < bun__poll_count; i++) {
        if (bun__poll_entries[i].handle == handle) {
            entry = &bun__poll_entries[i];
            break;
        }
    }
    if (!entry) {
        pthread_mutex_unlock(&bun__poll_mutex);
        return UV_EINVAL;
    }

    int was_active = entry->active;
#if defined(__APPLE__)
    int prev_events = entry->events;
#endif
    entry->events = events;
    entry->cb = cb;
    entry->active = 1;

#if defined(__linux__)
    struct epoll_event ev;
    ev.events = bun__uv_to_epoll(events);
    ev.data.fd = entry->fd;
    int op = was_active ? EPOLL_CTL_MOD : EPOLL_CTL_ADD;
    if (epoll_ctl(bun__epoll_fd, op, entry->fd, &ev) < 0) {
        // If MOD fails, try ADD (fd may have been re-opened)
        if (was_active && errno == ENOENT) {
            if (epoll_ctl(bun__epoll_fd, EPOLL_CTL_ADD, entry->fd, &ev) < 0) {
                int saved_errno = errno;
                entry->active = 0;
                pthread_mutex_unlock(&bun__poll_mutex);
                return UV__ERR(saved_errno);
            }
        } else {
            int saved_errno = errno;
            entry->active = 0;
            pthread_mutex_unlock(&bun__poll_mutex);
            return UV__ERR(saved_errno);
        }
    }
#elif defined(__APPLE__)
    struct kevent kev[4];
    int nkev = 0;

    // Remove filters that were previously registered but no longer wanted
    if (was_active && (prev_events & UV_READABLE) && !(events & UV_READABLE)) {
        EV_SET(&kev[nkev], entry->fd, EVFILT_READ, EV_DELETE, 0, 0, NULL);
        nkev++;
    }
    if (was_active && (prev_events & UV_WRITABLE) && !(events & UV_WRITABLE)) {
        EV_SET(&kev[nkev], entry->fd, EVFILT_WRITE, EV_DELETE, 0, 0, NULL);
        nkev++;
    }

    // Add/enable newly requested filters
    if (events & UV_READABLE) {
        EV_SET(&kev[nkev], entry->fd, EVFILT_READ,
               EV_ADD | EV_ENABLE, 0, 0, NULL);
        nkev++;
    }
    if (events & UV_WRITABLE) {
        EV_SET(&kev[nkev], entry->fd, EVFILT_WRITE,
               EV_ADD | EV_ENABLE, 0, 0, NULL);
        nkev++;
    }
    if (nkev > 0) {
        if (kevent(bun__kqueue_fd, kev, nkev, NULL, 0, NULL) < 0) {
            int saved_errno = errno;
            entry->active = 0;
            pthread_mutex_unlock(&bun__poll_mutex);
            return UV__ERR(saved_errno);
        }
    }
#endif

    pthread_mutex_unlock(&bun__poll_mutex);
    bun__poll_wakeup();

    return 0;
}

UV_EXTERN int uv_poll_stop(uv_poll_t* handle)
{
    if (!handle) return UV_EINVAL;

    pthread_mutex_lock(&bun__poll_mutex);

    for (int i = 0; i < bun__poll_count; i++) {
        if (bun__poll_entries[i].handle == handle && bun__poll_entries[i].active) {
            bun__poll_entries[i].active = 0;

#if defined(__linux__)
            if (epoll_ctl(bun__epoll_fd, EPOLL_CTL_DEL, bun__poll_entries[i].fd, NULL) < 0 && errno != EBADF && errno != ENOENT) {
                fprintf(stderr, "bun: epoll_ctl DEL fd=%d failed: %s\n", bun__poll_entries[i].fd, strerror(errno));
            }
#elif defined(__APPLE__)
            struct kevent kev[2];
            EV_SET(&kev[0], bun__poll_entries[i].fd, EVFILT_READ,
                   EV_DELETE, 0, 0, NULL);
            EV_SET(&kev[1], bun__poll_entries[i].fd, EVFILT_WRITE,
                   EV_DELETE, 0, 0, NULL);
            if (kevent(bun__kqueue_fd, kev, 2, NULL, 0, NULL) < 0 && errno != ENOENT && errno != EBADF) {
                fprintf(stderr, "bun: kevent DEL fd=%d failed: %s\n", bun__poll_entries[i].fd, strerror(errno));
            }
#endif
            break;
        }
    }

    pthread_mutex_unlock(&bun__poll_mutex);
    return 0;
}

// ═══════════════════════════════════════════════════════════════════
// uv_async_init / uv_async_send
// ═══════════════════════════════════════════════════════════════════

UV_EXTERN int uv_async_init(uv_loop_t* loop, uv_async_t* async,
    uv_async_cb async_cb)
{
    if (!async) return UV_EINVAL;

    int thread_err = bun__ensure_poll_thread();
    if (thread_err != 0) return thread_err;

    memset(async, 0, sizeof(uv_async_t));
    async->loop = loop;
    async->type = UV_ASYNC;

    int wakeup_fd = -1;
    int wakeup_wfd = -1;

#if defined(__linux__)
    wakeup_fd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    if (wakeup_fd < 0) return UV__ERR(errno);
#elif defined(__APPLE__)
    int pipefd[2];
    if (pipe(pipefd) < 0) return UV__ERR(errno);
    fcntl(pipefd[0], F_SETFL, O_NONBLOCK);
    fcntl(pipefd[1], F_SETFL, O_NONBLOCK);
    fcntl(pipefd[0], F_SETFD, FD_CLOEXEC);
    fcntl(pipefd[1], F_SETFD, FD_CLOEXEC);
    wakeup_fd = pipefd[0];
    wakeup_wfd = pipefd[1];
#endif

    pthread_mutex_lock(&bun__poll_mutex);

    if (bun__async_count >= BUN_UV_MAX_POLL_HANDLES) {
        pthread_mutex_unlock(&bun__poll_mutex);
        close(wakeup_fd);
        if (wakeup_wfd >= 0) close(wakeup_wfd);
        return UV_ENOMEM;
    }

    int idx = bun__async_count++;
    bun__async_entries[idx].handle = async;
    bun__async_entries[idx].cb = async_cb;
    bun__async_entries[idx].active = 1;
    bun__async_entries[idx].wakeup_fd = wakeup_fd;
    bun__async_entries[idx].wakeup_wfd = wakeup_wfd;

    // Register with epoll/kqueue
#if defined(__linux__)
    struct epoll_event ev = { .events = EPOLLIN, .data.fd = wakeup_fd };
    if (epoll_ctl(bun__epoll_fd, EPOLL_CTL_ADD, wakeup_fd, &ev) < 0) {
        int saved_errno = errno;
        bun__async_count--;
        bun__async_entries[idx].active = 0;
        pthread_mutex_unlock(&bun__poll_mutex);
        close(wakeup_fd);
        return UV__ERR(saved_errno);
    }
#elif defined(__APPLE__)
    struct kevent kev;
    EV_SET(&kev, wakeup_fd, EVFILT_READ, EV_ADD, 0, 0, NULL);
    if (kevent(bun__kqueue_fd, &kev, 1, NULL, 0, NULL) < 0) {
        int saved_errno = errno;
        bun__async_count--;
        bun__async_entries[idx].active = 0;
        pthread_mutex_unlock(&bun__poll_mutex);
        close(wakeup_fd);
        if (wakeup_wfd >= 0) close(wakeup_wfd);
        return UV__ERR(saved_errno);
    }
#endif

    pthread_mutex_unlock(&bun__poll_mutex);

    return 0;
}

UV_EXTERN int uv_async_send(uv_async_t* async)
{
    if (!async) return UV_EINVAL;

    pthread_mutex_lock(&bun__poll_mutex);

    for (int i = 0; i < bun__async_count; i++) {
        if (bun__async_entries[i].handle == async && bun__async_entries[i].active) {
#if defined(__linux__)
            uint64_t val = 1;
            (void)write(bun__async_entries[i].wakeup_fd, &val, sizeof(val));
#elif defined(__APPLE__)
            char c = 1;
            (void)write(bun__async_entries[i].wakeup_wfd, &c, 1);
#endif
            pthread_mutex_unlock(&bun__poll_mutex);
            return 0;
        }
    }

    pthread_mutex_unlock(&bun__poll_mutex);
    return UV_EINVAL;
}

// ═══════════════════════════════════════════════════════════════════
// uv_close — Handle cleanup (supports UV_POLL and UV_ASYNC)
// ═══════════════════════════════════════════════════════════════════

UV_EXTERN void uv_close(uv_handle_t* handle, uv_close_cb close_cb)
{
    if (!handle) return;

    // Handle UV_POLL
    if (handle->type == UV_POLL) {
        uv_poll_t* poll = (uv_poll_t*)handle;
        uv_poll_stop(poll);

        // Remove from entry table
        pthread_mutex_lock(&bun__poll_mutex);
        for (int i = 0; i < bun__poll_count; i++) {
            if (bun__poll_entries[i].handle == poll) {
                // Swap with last entry
                bun__poll_entries[i] = bun__poll_entries[--bun__poll_count];
                break;
            }
        }
        pthread_mutex_unlock(&bun__poll_mutex);

        if (close_cb) close_cb(handle);
        return;
    }

    // Handle UV_ASYNC
    if (handle->type == UV_ASYNC) {
        uv_async_t* async = (uv_async_t*)handle;

        pthread_mutex_lock(&bun__poll_mutex);
        for (int i = 0; i < bun__async_count; i++) {
            if (bun__async_entries[i].handle == async) {
                bun__async_entries[i].active = 0;

                // Remove from epoll/kqueue
#if defined(__linux__)
                if (epoll_ctl(bun__epoll_fd, EPOLL_CTL_DEL,
                              bun__async_entries[i].wakeup_fd, NULL) < 0 && errno != EBADF && errno != ENOENT) {
                    fprintf(stderr, "bun: epoll_ctl DEL async fd=%d failed: %s\n", bun__async_entries[i].wakeup_fd, strerror(errno));
                }
                close(bun__async_entries[i].wakeup_fd);
#elif defined(__APPLE__)
                struct kevent kev;
                EV_SET(&kev, bun__async_entries[i].wakeup_fd, EVFILT_READ,
                       EV_DELETE, 0, 0, NULL);
                if (kevent(bun__kqueue_fd, &kev, 1, NULL, 0, NULL) < 0 && errno != ENOENT && errno != EBADF) {
                    fprintf(stderr, "bun: kevent DEL async fd=%d failed: %s\n", bun__async_entries[i].wakeup_fd, strerror(errno));
                }
                close(bun__async_entries[i].wakeup_fd);
                close(bun__async_entries[i].wakeup_wfd);
#endif
                // Swap with last entry
                bun__async_entries[i] = bun__async_entries[--bun__async_count];
                break;
            }
        }
        pthread_mutex_unlock(&bun__poll_mutex);

        if (close_cb) close_cb(handle);
        return;
    }

    // Unknown handle type — still call callback to avoid leaks
    if (close_cb) close_cb(handle);
}

// ═══════════════════════════════════════════════════════════════════
// uv_unref — No-op for our implementation (poll thread is detached)
// ═══════════════════════════════════════════════════════════════════

UV_EXTERN void uv_unref(uv_handle_t* handle)
{
    (void)handle;
    // No-op: our poll thread is detached, doesn't keep process alive
}

#endif
