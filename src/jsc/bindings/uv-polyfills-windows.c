#include "uv-polyfills.h"

#include <winternl.h>

// Defined in c-bindings.cpp
void clock_gettime_monotonic(int64_t* tv_sec, int64_t* tv_nsec);
void* Bun__getOSFHandle(int fd);
int Bun__openOSFHandle(void* handle);

UV_EXTERN uv_pid_t uv_os_getpid(void)
{
    return GetCurrentProcessId();
}

// Copy-pasted from libuv
UV_EXTERN uv_pid_t uv_os_getppid(void)
{
    NTSTATUS nt_status;
    PROCESS_BASIC_INFORMATION basic_info;

    nt_status = NtQueryInformationProcess(GetCurrentProcess(),
        ProcessBasicInformation,
        &basic_info,
        sizeof(basic_info),
        NULL);
    if (NT_SUCCESS(nt_status)) {
        /* winternl.h's name for InheritedFromUniqueProcessId. */
        return (uv_pid_t)(uintptr_t)basic_info.Reserved3;
    } else {
        return -1;
    }
}

typedef struct {
    void (*callback)(void);
} uv__once_data_t;

// Copy-pasted from libuv
static BOOL WINAPI uv__once_inner(INIT_ONCE* once, void* param, void** context)
{
    uv__once_data_t* data = param;

    data->callback();

    return TRUE;
}

// Copy-pasted from libuv
UV_EXTERN void uv_once(uv_once_t* guard, void (*callback)(void))
{
    uv__once_data_t data = { .callback = callback };
    InitOnceExecuteOnce(&guard->init_once, uv__once_inner, (void*)&data, NULL);
}

// The clock of uv_now and uv_timer_t (uv.rs).
UV_EXTERN uint64_t uv_hrtime(void)
{
    int64_t sec;
    int64_t nsec;

    clock_gettime_monotonic(&sec, &nsec);

    return sec * (uint64_t)1e9 + nsec;
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_destroy(uv_mutex_t* mutex)
{
    DeleteCriticalSection(mutex);
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_init(uv_mutex_t* mutex)
{
    InitializeCriticalSection(mutex);
    return 0;
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_init_recursive(uv_mutex_t* mutex)
{
    return uv_mutex_init(mutex);
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_lock(uv_mutex_t* mutex)
{
    EnterCriticalSection(mutex);
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_trylock(uv_mutex_t* mutex)
{
    if (TryEnterCriticalSection(mutex))
        return 0;
    else
        return UV_EBUSY;
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_unlock(uv_mutex_t* mutex)
{
    LeaveCriticalSection(mutex);
}

UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return Bun__getOSFHandle(fd);
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    return Bun__openOSFHandle(os_fd);
}

UV_EXTERN int uv_tty_reset_mode(void)
{
    return 0;
}
