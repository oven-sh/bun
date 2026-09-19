// The uv_mutex_* functions are libuv's (src/win/thread.c).
#include "uv-polyfills.h"

uv_pid_t uv_os_getpid()
{
    return GetCurrentProcessId();
}

int32_t Bun__getParentProcessId(void);

uv_pid_t uv_os_getppid()
{
    return Bun__getParentProcessId();
}

static BOOL WINAPI uv__once_inner(INIT_ONCE* once, void* param, void** context)
{
    ((void (*)(void))param)();
    return TRUE;
}

UV_EXTERN void uv_once(uv_once_t* guard, void (*callback)(void))
{
    InitOnceExecuteOnce(&guard->init_once, uv__once_inner, (void*)callback, NULL);
}

UV_EXTERN uint64_t uv_hrtime(void)
{
    static LARGE_INTEGER frequency;
    LARGE_INTEGER counter;

    // QueryPerformanceFrequency always writes the same value, so racing
    // first calls are harmless.
    if (frequency.QuadPart == 0)
        QueryPerformanceFrequency(&frequency);

    QueryPerformanceCounter(&counter);

    // Split so the multiplication cannot overflow.
    uint64_t seconds = (uint64_t)counter.QuadPart / (uint64_t)frequency.QuadPart;
    uint64_t remainder = (uint64_t)counter.QuadPart % (uint64_t)frequency.QuadPart;
    return seconds * 1000000000ull + remainder * 1000000000ull / (uint64_t)frequency.QuadPart;
}

UV_EXTERN void uv_mutex_destroy(uv_mutex_t* mutex)
{
    DeleteCriticalSection(mutex);
}

UV_EXTERN int uv_mutex_init(uv_mutex_t* mutex)
{
    InitializeCriticalSection(mutex);
    return 0;
}

UV_EXTERN int uv_mutex_init_recursive(uv_mutex_t* mutex)
{
    return uv_mutex_init(mutex);
}

UV_EXTERN void uv_mutex_lock(uv_mutex_t* mutex)
{
    EnterCriticalSection(mutex);
}

UV_EXTERN int uv_mutex_trylock(uv_mutex_t* mutex)
{
    if (TryEnterCriticalSection(mutex))
        return 0;
    return UV_EBUSY;
}

UV_EXTERN void uv_mutex_unlock(uv_mutex_t* mutex)
{
    LeaveCriticalSection(mutex);
}
