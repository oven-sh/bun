#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD)

#include <pthread.h>
#include <sched.h>
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
// uv_handle_t / uv_async_t
// ---------------------------------------------------------------------------
//
// On POSIX Bun does not run a libuv event loop. The `uv_loop_t*` that
// `napi_get_uv_event_loop` / `uv_default_loop` hand out is really Bun's
// `*mut EventLoop` (see `napi_get_uv_event_loop` in
// src/runtime/napi/napi_body.rs). The shims below schedule work onto that
// loop and adjust its keep-alive refcount.
extern void Bun__uv_handle_schedule(uv_loop_t* loop, uv_handle_t* handle);
extern void Bun__uv_handle_ref(uv_loop_t* loop, int delta);
extern uv_loop_t* Bun__uv_default_loop(void);

// Match the bits libuv uses so addons that peek at handle->flags see what
// they expect (libuv's src/uv-common.h).
#define BUN_UV_HANDLE_CLOSING 0x00000001
#define BUN_UV_HANDLE_CLOSED 0x00000002
#define BUN_UV_HANDLE_ACTIVE 0x00000004
#define BUN_UV_HANDLE_REF 0x00000008

// uv_async_t->pending is our "task is queued" bit: 0 idle, 1 queued. uv_close
// sets it to 2 so subsequent uv_async_send calls observe non-zero and skip
// scheduling.
#define BUN_UV_ASYNC_CLOSING 2

static int bun__is_supported_handle(const uv_handle_t* handle)
{
    return handle->type == UV_ASYNC;
}

UV_EXTERN uv_loop_t* uv_default_loop(void)
{
    return Bun__uv_default_loop();
}

UV_EXTERN void* uv_handle_get_data(const uv_handle_t* handle)
{
    return handle->data;
}

UV_EXTERN void uv_handle_set_data(uv_handle_t* handle, void* data)
{
    handle->data = data;
}

UV_EXTERN uv_loop_t* uv_handle_get_loop(const uv_handle_t* handle)
{
    return handle->loop;
}

UV_EXTERN uv_handle_type uv_handle_get_type(const uv_handle_t* handle)
{
    return handle->type;
}

UV_EXTERN int uv_has_ref(const uv_handle_t* handle)
{
    return (handle->flags & BUN_UV_HANDLE_REF) != 0;
}

UV_EXTERN int uv_is_active(const uv_handle_t* handle)
{
    return (handle->flags & BUN_UV_HANDLE_ACTIVE) != 0;
}

UV_EXTERN int uv_is_closing(const uv_handle_t* handle)
{
    return (handle->flags & (BUN_UV_HANDLE_CLOSING | BUN_UV_HANDLE_CLOSED)) != 0;
}

UV_EXTERN void uv_ref(uv_handle_t* handle)
{
    if (!bun__is_supported_handle(handle)) {
        __bun_throw_not_implemented("uv_ref");
    }
    if (handle->flags & BUN_UV_HANDLE_REF)
        return;
    handle->flags |= BUN_UV_HANDLE_REF;
    if ((handle->flags & BUN_UV_HANDLE_ACTIVE) && !(handle->flags & BUN_UV_HANDLE_CLOSING))
        Bun__uv_handle_ref(handle->loop, 1);
}

UV_EXTERN void uv_unref(uv_handle_t* handle)
{
    if (!bun__is_supported_handle(handle)) {
        __bun_throw_not_implemented("uv_unref");
    }
    if (!(handle->flags & BUN_UV_HANDLE_REF))
        return;
    handle->flags &= ~BUN_UV_HANDLE_REF;
    if ((handle->flags & BUN_UV_HANDLE_ACTIVE) && !(handle->flags & BUN_UV_HANDLE_CLOSING))
        Bun__uv_handle_ref(handle->loop, -1);
}

UV_EXTERN int uv_async_init(uv_loop_t* loop, uv_async_t* handle, uv_async_cb async_cb)
{
    handle->loop = loop;
    handle->type = UV_ASYNC;
    handle->close_cb = NULL;
    handle->next_closing = NULL;
    // libuv: uv__handle_init sets REF, then uv__handle_start sets ACTIVE and
    // bumps loop->active_handles. Mirror that so a freshly initialized async
    // handle keeps the loop alive.
    handle->flags = BUN_UV_HANDLE_REF | BUN_UV_HANDLE_ACTIVE;
    handle->async_cb = async_cb;
    handle->u.fd = 0;
    __atomic_store_n(&handle->pending, 0, __ATOMIC_SEQ_CST);
    Bun__uv_handle_ref(loop, 1);
    return 0;
}

UV_EXTERN int uv_async_send(uv_async_t* handle)
{
    // libuv coalesces: only the 0->1 transition schedules. handle->u.fd is the
    // "busy" counter libuv uses so uv_close can spin until no thread is between
    // the exchange and the schedule below.
    if (__atomic_load_n(&handle->pending, __ATOMIC_RELAXED) != 0)
        return 0;
    __atomic_fetch_add(&handle->u.fd, 1, __ATOMIC_SEQ_CST);
    if (__atomic_exchange_n(&handle->pending, 1, __ATOMIC_SEQ_CST) == 0)
        Bun__uv_handle_schedule(handle->loop, (uv_handle_t*)handle);
    __atomic_fetch_sub(&handle->u.fd, 1, __ATOMIC_SEQ_CST);
    return 0;
}

// Called from the event loop's task dispatcher on the loop thread.
UV_EXTERN void Bun__uv_handle_dispatch(uv_handle_t* handle)
{
    if (handle->type != UV_ASYNC)
        return;
    uv_async_t* async = (uv_async_t*)handle;
    if (handle->flags & BUN_UV_HANDLE_CLOSING) {
        // uv_close ran; this is the deferred close. Leave pending non-zero so
        // a racing uv_async_send cannot schedule a second task behind the
        // close callback. Release the loop ref uv_close held (or took) so the
        // process can exit once the close callback returns.
        handle->flags |= BUN_UV_HANDLE_CLOSED;
        Bun__uv_handle_ref(handle->loop, -1);
        if (handle->close_cb != NULL)
            handle->close_cb(handle);
        return;
    }
    // Reset before the callback so a send inside the callback schedules again,
    // matching libuv's uv__async_io.
    __atomic_store_n(&async->pending, 0, __ATOMIC_SEQ_CST);
    if (async->async_cb != NULL)
        async->async_cb(async);
}

static void bun__uv_async_spin(uv_async_t* handle)
{
    int i;
    for (;;) {
        for (i = 0; i < 997; i++) {
            if (__atomic_load_n(&handle->u.fd, __ATOMIC_SEQ_CST) == 0)
                return;
#if defined(__i386__) || defined(__x86_64__)
            __asm__ __volatile__("pause" ::: "memory");
#elif defined(__aarch64__) || defined(__arm__)
            __asm__ __volatile__("yield" ::: "memory");
#endif
        }
        sched_yield();
    }
}

UV_EXTERN void uv_close(uv_handle_t* handle, uv_close_cb close_cb)
{
    if (!bun__is_supported_handle(handle)) {
        __bun_throw_not_implemented("uv_close");
    }
    handle->close_cb = close_cb;
    if (handle->flags & BUN_UV_HANDLE_CLOSING)
        return;
    // A closing handle keeps the loop alive until close_cb runs (libuv's
    // closing_handles list). If the handle was unref'd, take a ref back for
    // the duration of the deferred close; Bun__uv_handle_dispatch drops it.
    int had_active_ref = (handle->flags & BUN_UV_HANDLE_REF) && (handle->flags & BUN_UV_HANDLE_ACTIVE);
    if (!had_active_ref)
        Bun__uv_handle_ref(handle->loop, 1);
    handle->flags |= BUN_UV_HANDLE_CLOSING;
    handle->flags &= ~BUN_UV_HANDLE_ACTIVE;

    uv_async_t* async = (uv_async_t*)handle;
    // Force pending non-zero so no uv_async_send after this point schedules a
    // new task, then wait for any send that is mid-flight between its exchange
    // and its schedule call.
    int prev = __atomic_exchange_n(&async->pending, BUN_UV_ASYNC_CLOSING, __ATOMIC_SEQ_CST);
    bun__uv_async_spin(async);
    if (prev == 0) {
        // No send task is or will be queued; schedule the close ourselves.
        Bun__uv_handle_schedule(handle->loop, handle);
    } else {
        // A send already queued a task (or is about to, within the spin window
        // we just waited out). That task will observe CLOSING above and run the
        // close path instead of async_cb.
    }
}

#endif
