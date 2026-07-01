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

/* POSIX real impls for the symbols shared with the Windows polyfill set. */
#include <signal.h>
#include <sys/resource.h>
#include <errno.h>

UV_EXTERN int uv_kill(int pid, int signum)
{
    return kill(pid, signum) ? -errno : 0;
}

UV_EXTERN int uv_os_getpriority(uv_pid_t pid, int* priority)
{
    int r;
    if (priority == NULL)
        return UV_EINVAL;
    errno = 0;
    r = getpriority(PRIO_PROCESS, (int)pid);
    if (r == -1 && errno != 0)
        return -errno;
    *priority = r;
    return 0;
}

UV_EXTERN int uv_os_setpriority(uv_pid_t pid, int priority)
{
    if (priority < -20 || priority > 19)
        return UV_EINVAL;
    return setpriority(PRIO_PROCESS, (int)pid, priority) ? -errno : 0;
}

UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return fd;
}

/* Crash stubs on POSIX (today's behavior — these were generated stubs);
 * Windows carries real implementations in its block below. */
UV_EXTERN int uv_cpu_info(uv_cpu_info_t** cpu_infos, int* count)
{
    __bun_throw_not_implemented("uv_cpu_info");
    __builtin_unreachable();
}

UV_EXTERN void uv_free_cpu_info(uv_cpu_info_t* cpu_infos, int count)
{
    __bun_throw_not_implemented("uv_free_cpu_info");
    __builtin_unreachable();
}

UV_EXTERN int uv_interface_addresses(uv_interface_address_t** addresses,
    int* count)
{
    __bun_throw_not_implemented("uv_interface_addresses");
    __builtin_unreachable();
}

UV_EXTERN void uv_free_interface_addresses(uv_interface_address_t* addresses,
    int count)
{
    __bun_throw_not_implemented("uv_free_interface_addresses");
    __builtin_unreachable();
}

extern void Bun__ensure_winsock(void);

UV_EXTERN int uv_inet_ntop(int af, const void* src, char* dst, size_t size)
{
    Bun__ensure_winsock();
    __bun_throw_not_implemented("uv_inet_ntop");
    __builtin_unreachable();
}

UV_EXTERN int uv_getrusage(uv_rusage_t* rusage)
{
    __bun_throw_not_implemented("uv_getrusage");
    __builtin_unreachable();
}

UV_EXTERN int uv_resident_set_memory(size_t* rss)
{
    __bun_throw_not_implemented("uv_resident_set_memory");
    __builtin_unreachable();
}

UV_EXTERN uv_handle_type uv_guess_handle(uv_file file)
{
    __bun_throw_not_implemented("uv_guess_handle");
    __builtin_unreachable();
}

#elif OS(WINDOWS)

#include <windows.h>
#include <winternl.h>
#include <stdlib.h>

uv_pid_t uv_os_getpid()
{
    return (uv_pid_t)GetCurrentProcessId();
}

typedef NTSTATUS(NTAPI* NtQueryInformationProcessFn)(HANDLE, ULONG, PVOID, ULONG, PULONG);

/* PROCESS_BASIC_INFORMATION with the real ntddk field names — winternl.h
 * hides InheritedFromUniqueProcessId inside Reserved3. */
typedef struct {
    NTSTATUS ExitStatus;
    PVOID PebBaseAddress;
    ULONG_PTR AffinityMask;
    LONG BasePriority;
    ULONG_PTR UniqueProcessId;
    ULONG_PTR InheritedFromUniqueProcessId;
} bun__process_basic_information_t;

uv_pid_t uv_os_getppid()
{
    /* libuv win/util.c uv_os_getppid:
     * NtQueryInformationProcess(ProcessBasicInformation). */
    bun__process_basic_information_t pbi;
    ULONG len = 0;
    NtQueryInformationProcessFn q = (NtQueryInformationProcessFn)(void*)GetProcAddress(
        GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess");
    if (!q)
        return -1;
    if (q(GetCurrentProcess(), 0 /* ProcessBasicInformation */, &pbi, sizeof(pbi), &len) != 0)
        return -1;
    return (uv_pid_t)pbi.InheritedFromUniqueProcessId;
}

/* Port of libuv 1.51 win/thread.c uv_once (uv_once_t wraps an INIT_ONCE). */
static BOOL WINAPI uv__once_inner(INIT_ONCE* once, void* param, void** context)
{
    void (*callback)(void) = (void (*)(void))(uintptr_t)param;
    callback();
    return TRUE;
}

UV_EXTERN void uv_once(uv_once_t* guard, void (*callback)(void))
{
    if (!InitOnceExecuteOnce(&guard->init_once, uv__once_inner, (void*)(uintptr_t)callback, NULL))
        abort();
}

/* c-bindings.cpp owns the QPC monotonic clock (cached frequency + the
 * overflow-safe split); this polyfill is a thin adapter over it. */
extern int clock_gettime_monotonic(int64_t* sec, int64_t* nsec);

UV_EXTERN uint64_t uv_hrtime(void)
{
    int64_t s, ns;
    if (clock_gettime_monotonic(&s, &ns) != 0)
        abort(); /* libuv parity: uv_fatal_error on a broken QPC */
    return (uint64_t)s * 1000000000ull + (uint64_t)ns;
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
    /* CRITICAL_SECTION is always recursive. */
    InitializeCriticalSection(mutex);
    return 0;
}

UV_EXTERN void uv_mutex_lock(uv_mutex_t* mutex)
{
    EnterCriticalSection(mutex);
}

UV_EXTERN int uv_mutex_trylock(uv_mutex_t* mutex)
{
    return TryEnterCriticalSection(mutex) ? 0 : UV_EBUSY;
}

UV_EXTERN void uv_mutex_unlock(uv_mutex_t* mutex)
{
    LeaveCriticalSection(mutex);
}

UV_EXTERN int uv_kill(int pid, int signum)
{
    /* Port of libuv win/process.c uv_kill semantics: 0 probes liveness,
     * the fatal signals terminate with code 1, everything else ENOSYS.
     * pid 0 targets the current process via the GetCurrentProcess pseudo-
     * handle, as in libuv (CloseHandle on it is a documented no-op). */
    HANDLE h;
    DWORD status;
    if (signum == 0) {
        h = pid == 0 ? GetCurrentProcess()
                     : OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
        if (h == NULL)
            return GetLastError() == ERROR_INVALID_PARAMETER ? UV_ESRCH : UV_EPERM;
        int alive = GetExitCodeProcess(h, &status) && status == STILL_ACTIVE;
        CloseHandle(h);
        return alive ? 0 : UV_ESRCH;
    }
    switch (signum) {
    case 2 /* SIGINT */:
    case 3 /* SIGQUIT */:
    case 9 /* SIGKILL */:
    case 15 /* SIGTERM */: {
        h = pid == 0 ? GetCurrentProcess()
                     : OpenProcess(PROCESS_TERMINATE, FALSE, (DWORD)pid);
        if (h == NULL)
            return GetLastError() == ERROR_INVALID_PARAMETER ? UV_ESRCH : UV_EPERM;
        int ok = TerminateProcess(h, 1);
        CloseHandle(h);
        if (ok)
            return 0;
        return GetLastError() == ERROR_ACCESS_DENIED ? UV_EPERM : UV_ESRCH;
    }
    default:
        return UV_ENOSYS;
    }
}

UV_EXTERN int uv_os_getpriority(uv_pid_t pid, int* priority)
{
    /* libuv win/util.c: PriorityClass → the nice-value buckets. */
    HANDLE h;
    DWORD cls;
    if (priority == NULL)
        return UV_EINVAL;
    h = pid == 0 ? GetCurrentProcess()
                 : OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
    if (h == NULL)
        return UV_ESRCH;
    cls = GetPriorityClass(h);
    if (pid != 0)
        CloseHandle(h);
    switch (cls) {
    case 0:
        return UV_ESRCH;
    case REALTIME_PRIORITY_CLASS:
        *priority = -20; /* UV_PRIORITY_HIGHEST */
        break;
    case HIGH_PRIORITY_CLASS:
        *priority = -14; /* UV_PRIORITY_HIGH */
        break;
    case ABOVE_NORMAL_PRIORITY_CLASS:
        *priority = -7; /* UV_PRIORITY_ABOVE_NORMAL */
        break;
    case NORMAL_PRIORITY_CLASS:
        *priority = 0; /* UV_PRIORITY_NORMAL */
        break;
    case BELOW_NORMAL_PRIORITY_CLASS:
        *priority = 10; /* UV_PRIORITY_BELOW_NORMAL */
        break;
    case IDLE_PRIORITY_CLASS:
    default:
        *priority = 19; /* UV_PRIORITY_LOW */
        break;
    }
    return 0;
}

UV_EXTERN int uv_os_setpriority(uv_pid_t pid, int priority)
{
    HANDLE h;
    DWORD cls;
    if (priority < -20 || priority > 19)
        return UV_EINVAL;
    if (priority <= -14 /* UV_PRIORITY_HIGH..HIGHEST */)
        cls = priority <= -20 ? REALTIME_PRIORITY_CLASS : HIGH_PRIORITY_CLASS;
    else if (priority <= -7)
        cls = ABOVE_NORMAL_PRIORITY_CLASS;
    else if (priority <= 0)
        cls = NORMAL_PRIORITY_CLASS;
    else if (priority <= 10)
        cls = BELOW_NORMAL_PRIORITY_CLASS;
    else
        cls = IDLE_PRIORITY_CLASS;
    h = pid == 0 ? GetCurrentProcess()
                 : OpenProcess(PROCESS_SET_INFORMATION, FALSE, (DWORD)pid);
    if (h == NULL)
        return UV_ESRCH;
    int ok = SetPriorityClass(h, cls);
    if (pid != 0)
        CloseHandle(h);
    return ok ? 0 : UV_EPERM;
}

/* JS-visible fd numbers are Bun fd-table indices now — the table, not the
 * CRT, answers fd→HANDLE. Implemented in Rust (bun_sys). */
extern void* Bun__FdTable__nativeHandle(int fd);

UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    return (uv_os_fd_t)Bun__FdTable__nativeHandle(fd);
}

UV_EXTERN uv_handle_type uv_guess_handle(uv_file file)
{
    /* libuv win/handle.c uv_guess_handle, fd resolved via the fd table. */
    HANDLE handle;
    DWORD mode;
    if (file < 0)
        return UV_UNKNOWN_HANDLE;
    handle = (HANDLE)Bun__FdTable__nativeHandle(file);
    switch (GetFileType(handle)) {
    case FILE_TYPE_CHAR:
        return GetConsoleMode(handle, &mode) ? UV_TTY : UV_FILE;
    case FILE_TYPE_PIPE:
        return UV_NAMED_PIPE;
    case FILE_TYPE_DISK:
        return UV_FILE;
    default:
        return UV_UNKNOWN_HANDLE;
    }
}

#include <psapi.h>
#include <iphlpapi.h>
/* GetAdaptersAddresses + Reg*; same embedded-defaultlib pattern as cares. */
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "advapi32.lib")

/* Minimal Win32→UV mapping for the polyfilled surface; libuv's full table is
 * win/error.c and collapses unmapped codes to UV_UNKNOWN the same way. */
static int bun__uv_translate_sys_error(DWORD err)
{
    switch (err) {
    case ERROR_ACCESS_DENIED:
    case ERROR_NOACCESS:
    case ERROR_ELEVATION_REQUIRED:
        return UV_EACCES;
    case ERROR_NOT_ENOUGH_MEMORY:
    case ERROR_OUTOFMEMORY:
        return UV_ENOMEM;
    case ERROR_INVALID_HANDLE:
        return UV_EBADF;
    case ERROR_INVALID_PARAMETER:
        return UV_EINVAL;
    case ERROR_FILE_NOT_FOUND:
        return UV_ENOENT;
    default:
        return UV_UNKNOWN;
    }
}

UV_EXTERN int uv_resident_set_memory(size_t* rss)
{
    /* libuv win/util.c: current working set, not the peak. */
    PROCESS_MEMORY_COUNTERS pmc;
    if (!GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc)))
        return bun__uv_translate_sys_error(GetLastError());
    *rss = pmc.WorkingSetSize;
    return 0;
}

UV_EXTERN int uv_getrusage(uv_rusage_t* uv_rusage)
{
    /* Port of libuv win/util.c uv_getrusage, including its
     * FileTimeToSystemTime conversion (CPU time wraps at 24h upstream too). */
    FILETIME create_time, exit_time, kernel_time, user_time;
    SYSTEMTIME kernel_system_time, user_system_time;
    PROCESS_MEMORY_COUNTERS mem_counters;
    IO_COUNTERS io_counters;

    if (!GetProcessTimes(GetCurrentProcess(), &create_time, &exit_time, &kernel_time, &user_time))
        return bun__uv_translate_sys_error(GetLastError());
    if (!FileTimeToSystemTime(&kernel_time, &kernel_system_time))
        return bun__uv_translate_sys_error(GetLastError());
    if (!FileTimeToSystemTime(&user_time, &user_system_time))
        return bun__uv_translate_sys_error(GetLastError());
    if (!GetProcessMemoryInfo(GetCurrentProcess(), &mem_counters, sizeof(mem_counters)))
        return bun__uv_translate_sys_error(GetLastError());
    if (!GetProcessIoCounters(GetCurrentProcess(), &io_counters))
        return bun__uv_translate_sys_error(GetLastError());

    memset(uv_rusage, 0, sizeof(*uv_rusage));

    uv_rusage->ru_utime.tv_sec = user_system_time.wHour * 3600 + user_system_time.wMinute * 60 + user_system_time.wSecond;
    uv_rusage->ru_utime.tv_usec = user_system_time.wMilliseconds * 1000;

    uv_rusage->ru_stime.tv_sec = kernel_system_time.wHour * 3600 + kernel_system_time.wMinute * 60 + kernel_system_time.wSecond;
    uv_rusage->ru_stime.tv_usec = kernel_system_time.wMilliseconds * 1000;

    uv_rusage->ru_majflt = (uint64_t)mem_counters.PageFaultCount;
    uv_rusage->ru_maxrss = (uint64_t)mem_counters.PeakWorkingSetSize / 1024;

    uv_rusage->ru_oublock = (uint64_t)io_counters.WriteOperationCount;
    uv_rusage->ru_inblock = (uint64_t)io_counters.ReadOperationCount;

    return 0;
}

/* SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION with the real ntddk field names —
 * winternl.h hides DpcTime/InterruptTime inside Reserved1[2]. */
typedef struct {
    LARGE_INTEGER IdleTime;
    LARGE_INTEGER KernelTime;
    LARGE_INTEGER UserTime;
    LARGE_INTEGER DpcTime;
    LARGE_INTEGER InterruptTime;
    ULONG InterruptCount;
} bun__sppi_t;

typedef NTSTATUS(NTAPI* NtQuerySystemInformationFn)(ULONG, PVOID, ULONG, PULONG);

UV_EXTERN int uv_cpu_info(uv_cpu_info_t** cpu_infos_ptr, int* cpu_count_ptr)
{
    /* Port of libuv win/util.c uv_cpu_info: count from GetSystemInfo, times
     * from NtQuerySystemInformation(SystemProcessorPerformanceInformation),
     * speed/model from HARDWARE\DESCRIPTION\System\CentralProcessor\<i>.
     * Identical malloc contract: uv_free_cpu_info frees models + array. */
    uv_cpu_info_t* cpu_infos = NULL;
    bun__sppi_t* sppi = NULL;
    SYSTEM_INFO system_info;
    DWORD cpu_count, i;
    ULONG result_size;
    DWORD err;

    NtQuerySystemInformationFn query = (NtQuerySystemInformationFn)(void*)GetProcAddress(
        GetModuleHandleW(L"ntdll.dll"), "NtQuerySystemInformation");
    if (query == NULL)
        return UV_ENOSYS;

    GetSystemInfo(&system_info);
    cpu_count = system_info.dwNumberOfProcessors;

    cpu_infos = (uv_cpu_info_t*)calloc(cpu_count, sizeof(*cpu_infos));
    if (cpu_infos == NULL) {
        err = ERROR_OUTOFMEMORY;
        goto error;
    }

    sppi = (bun__sppi_t*)malloc(cpu_count * sizeof(*sppi));
    if (sppi == NULL) {
        err = ERROR_OUTOFMEMORY;
        goto error;
    }

    /* 8 = SystemProcessorPerformanceInformation */
    if (query(8, sppi, cpu_count * (ULONG)sizeof(*sppi), &result_size) != 0) {
        err = ERROR_INVALID_DATA;
        goto error;
    }

    for (i = 0; i < cpu_count; i++) {
        WCHAR key_name[128];
        HKEY processor_key;
        DWORD cpu_speed;
        DWORD cpu_speed_size = sizeof(cpu_speed);
        WCHAR cpu_brand[256] = { 0 };
        /* Leave room so the value is always NUL-terminated even if the
         * registry data isn't. */
        DWORD cpu_brand_size = sizeof(cpu_brand) - sizeof(WCHAR);
        uv_cpu_info_t* cpu_info;

        _snwprintf(key_name, sizeof(key_name) / sizeof(key_name[0]),
            L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\%d", (int)i);

        err = (DWORD)RegOpenKeyExW(HKEY_LOCAL_MACHINE, key_name, 0, KEY_QUERY_VALUE, &processor_key);
        if (err != ERROR_SUCCESS)
            goto error;

        err = (DWORD)RegQueryValueExW(processor_key, L"~MHz", NULL, NULL, (BYTE*)&cpu_speed, &cpu_speed_size);
        if (err != ERROR_SUCCESS) {
            RegCloseKey(processor_key);
            goto error;
        }

        err = (DWORD)RegQueryValueExW(processor_key, L"ProcessorNameString", NULL, NULL, (BYTE*)cpu_brand, &cpu_brand_size);
        RegCloseKey(processor_key);
        if (err != ERROR_SUCCESS)
            goto error;

        cpu_info = &cpu_infos[i];
        cpu_info->speed = (int)cpu_speed;
        cpu_info->cpu_times.user = (uint64_t)sppi[i].UserTime.QuadPart / 10000;
        cpu_info->cpu_times.sys = (uint64_t)(sppi[i].KernelTime.QuadPart - sppi[i].IdleTime.QuadPart) / 10000;
        cpu_info->cpu_times.idle = (uint64_t)sppi[i].IdleTime.QuadPart / 10000;
        cpu_info->cpu_times.irq = (uint64_t)sppi[i].InterruptTime.QuadPart / 10000;
        cpu_info->cpu_times.nice = 0;

        {
            int n = WideCharToMultiByte(CP_UTF8, 0, cpu_brand, -1, NULL, 0, NULL, NULL);
            if (n <= 0) {
                err = ERROR_INVALID_DATA;
                goto error;
            }
            cpu_info->model = (char*)malloc((size_t)n);
            if (cpu_info->model == NULL) {
                err = ERROR_OUTOFMEMORY;
                goto error;
            }
            WideCharToMultiByte(CP_UTF8, 0, cpu_brand, -1, cpu_info->model, n, NULL, NULL);
        }
    }

    free(sppi);

    *cpu_count_ptr = (int)cpu_count;
    *cpu_infos_ptr = cpu_infos;
    return 0;

error:
    if (cpu_infos != NULL) {
        /* Safe: the array is zeroed on allocation. */
        for (i = 0; i < cpu_count; i++)
            free(cpu_infos[i].model);
    }
    free(cpu_infos);
    free(sppi);
    return bun__uv_translate_sys_error(err);
}

UV_EXTERN void uv_free_cpu_info(uv_cpu_info_t* cpu_infos, int count)
{
    int i;
    for (i = 0; i < count; i++)
        free(cpu_infos[i].model);
    free(cpu_infos);
}

UV_EXTERN int uv_interface_addresses(uv_interface_address_t** addresses_ptr,
    int* count_ptr)
{
    /* Port of libuv win/util.c uv_interface_addresses: one allocation holds
     * the uv_interface_address_t array followed by the UTF-8 names, so
     * uv_free_interface_addresses frees just the array. Prefix lengths are
     * clamped before they index into the netmask bytes. */
    IP_ADAPTER_ADDRESSES* win_address_buf;
    ULONG win_address_buf_size;
    IP_ADAPTER_ADDRESSES* adapter;
    uv_interface_address_t* uv_address_buf;
    char* name_buf;
    size_t uv_address_buf_size;
    uv_interface_address_t* uv_address;
    int count;
    ULONG flags;

    *addresses_ptr = NULL;
    *count_ptr = 0;

    flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;

    win_address_buf_size = 0;
    win_address_buf = NULL;

    for (;;) {
        ULONG r = GetAdaptersAddresses(AF_UNSPEC, flags, NULL, win_address_buf, &win_address_buf_size);
        if (r == ERROR_SUCCESS)
            break;

        free(win_address_buf);

        switch (r) {
        case ERROR_BUFFER_OVERFLOW:
            win_address_buf = (IP_ADAPTER_ADDRESSES*)malloc(win_address_buf_size);
            if (win_address_buf == NULL)
                return UV_ENOMEM;
            continue;

        case ERROR_NO_DATA:
            /* No adapters: a valid, empty, freeable result. */
            uv_address_buf = (uv_interface_address_t*)malloc(1);
            if (uv_address_buf == NULL)
                return UV_ENOMEM;
            *count_ptr = 0;
            *addresses_ptr = uv_address_buf;
            return 0;

        case ERROR_ADDRESS_NOT_ASSOCIATED:
            return UV_EAGAIN;

        case ERROR_INVALID_PARAMETER:
            /* Per libuv: adapter data larger than ULONG_MAX. */
            return UV_ENOBUFS;

        default:
            return bun__uv_translate_sys_error(r);
        }
    }

    /* Pass 1: count addresses on up interfaces; size the joint buffer. */
    count = 0;
    uv_address_buf_size = 0;

    for (adapter = win_address_buf; adapter != NULL; adapter = adapter->Next) {
        IP_ADAPTER_UNICAST_ADDRESS* unicast_address;
        int name_size;

        if (adapter->OperStatus != IfOperStatusUp || adapter->FirstUnicastAddress == NULL)
            continue;

        /* Includes the NUL terminator (cchWideChar == -1). */
        name_size = WideCharToMultiByte(CP_UTF8, 0, adapter->FriendlyName, -1, NULL, 0, NULL, NULL);
        if (name_size <= 0) {
            free(win_address_buf);
            return bun__uv_translate_sys_error(GetLastError());
        }
        uv_address_buf_size += (size_t)name_size;

        for (unicast_address = adapter->FirstUnicastAddress;
            unicast_address != NULL;
            unicast_address = unicast_address->Next) {
            count++;
            uv_address_buf_size += sizeof(uv_interface_address_t);
        }
    }

    uv_address_buf = (uv_interface_address_t*)malloc(uv_address_buf_size);
    if (uv_address_buf == NULL) {
        free(win_address_buf);
        return UV_ENOMEM;
    }

    uv_address = uv_address_buf;
    name_buf = (char*)(uv_address_buf + count);

    /* Pass 2: fill. */
    for (adapter = win_address_buf; adapter != NULL; adapter = adapter->Next) {
        IP_ADAPTER_UNICAST_ADDRESS* unicast_address;
        int name_size;
        size_t remaining;

        if (adapter->OperStatus != IfOperStatusUp || adapter->FirstUnicastAddress == NULL)
            continue;

        remaining = (size_t)((char*)uv_address_buf + uv_address_buf_size - name_buf);
        name_size = WideCharToMultiByte(CP_UTF8, 0, adapter->FriendlyName, -1, name_buf, (int)remaining, NULL, NULL);
        if (name_size <= 0) {
            free(win_address_buf);
            free(uv_address_buf);
            return bun__uv_translate_sys_error(GetLastError());
        }

        for (unicast_address = adapter->FirstUnicastAddress;
            unicast_address != NULL;
            unicast_address = unicast_address->Next) {
            struct sockaddr* sa = unicast_address->Address.lpSockaddr;
            ULONG prefix_len = unicast_address->OnLinkPrefixLength;

            memset(uv_address, 0, sizeof(*uv_address));

            uv_address->name = name_buf;

            if (adapter->PhysicalAddressLength == sizeof(uv_address->phys_addr)) {
                memcpy(uv_address->phys_addr, adapter->PhysicalAddress, sizeof(uv_address->phys_addr));
            }

            uv_address->is_internal = (adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK);

            if (sa->sa_family == AF_INET6) {
                if (prefix_len > 128)
                    prefix_len = 128;
                uv_address->address.address6 = *((struct sockaddr_in6*)sa);
                uv_address->netmask.netmask6.sin6_family = AF_INET6;
                memset(uv_address->netmask.netmask6.sin6_addr.s6_addr, 0xff, prefix_len >> 3);
                /* Partial byte of a non-multiple-of-8 prefix. */
                if (prefix_len % 8) {
                    uv_address->netmask.netmask6.sin6_addr.s6_addr[prefix_len >> 3] = (unsigned char)(0xff << (8 - prefix_len % 8));
                }
            } else {
                if (prefix_len > 32)
                    prefix_len = 32;
                uv_address->address.address4 = *((struct sockaddr_in*)sa);
                uv_address->netmask.netmask4.sin_family = AF_INET;
                uv_address->netmask.netmask4.sin_addr.s_addr = (prefix_len > 0) ? htonl(0xffffffffu << (32 - prefix_len)) : 0;
            }

            uv_address++;
        }

        name_buf += name_size;
    }

    free(win_address_buf);

    *addresses_ptr = uv_address_buf;
    *count_ptr = count;
    return 0;
}

UV_EXTERN void uv_free_interface_addresses(uv_interface_address_t* addresses,
    int count)
{
    /* Names live inside the same allocation (win/util.c layout). */
    (void)count;
    free(addresses);
}

UV_EXTERN int uv_inet_ntop(int af, const void* src, char* dst, size_t size)
{
    /* InetNtopA over libuv's hand-rolled formatter; same contract: 0 on
     * success, UV_EAFNOSUPPORT for a bad family, UV_ENOSPC when dst is too
     * small (InetNtopA's only failure mode for a valid family). */
    if (af != AF_INET && af != AF_INET6)
        return UV_EAFNOSUPPORT;
    if (InetNtopA(af, src, dst, size) == NULL)
        return WSAGetLastError() == ERROR_INVALID_PARAMETER ? UV_ENOSPC : UV_EINVAL;
    return 0;
}

/* POSIX defines uv_tty_reset_mode in wtf-bindings.cpp (termios); the Windows
 * twin restores the startup console input mode through the Rust tty engine. */
extern void Bun__Tty__resetMode(void);

UV_EXTERN int uv_tty_reset_mode(void)
{
    Bun__Tty__resetMode();
    return 0;
}

#endif

/* ── shared real polyfills (every supported OS) ─────────────────────── */
#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD) || OS(WINDOWS)

void __bun_throw_not_implemented(const char* symbol_name)
{
    CrashHandler__unsupportedUVFunction(symbol_name);
}

UV_EXTERN const char* uv_version_string(void)
{
    /* The uv ABI level Bun emulates (stub headers' uv/version.h). */
#define BUN__UV_STR2(x) #x
#define BUN__UV_STR(x) BUN__UV_STR2(x)
    return BUN__UV_STR(UV_VERSION_MAJOR) "." BUN__UV_STR(UV_VERSION_MINOR) "." BUN__UV_STR(UV_VERSION_PATCH) UV_VERSION_SUFFIX;
}

UV_EXTERN const char* uv_strerror(int err)
{
    /* libuv's message table via the header's own X-macro; unknown codes get
     * the libuv "Unknown system error" shape (static buffer — same
     * thread-safety caveat as libuv's own implementation). */
    switch (err) {
#define UV_STRERROR_GEN(name, msg) \
    case UV_##name:                \
        return msg;
        UV_ERRNO_MAP(UV_STRERROR_GEN)
#undef UV_STRERROR_GEN
    default:
        break;
    }
    {
        static char unknown[48];
        snprintf(unknown, sizeof(unknown), "Unknown system error %d", err);
        return unknown;
    }
}

#endif

