#include "root.h"

#if OS(WINDOWS)

#include "BunWindowsProcess.h"
#include <uv/errno.h>
#include <windows.h>
#include "BunWinternl.h"
#include <psapi.h>

extern "C" int32_t Bun__getParentProcessId()
{
    PROCESS_BASIC_INFORMATION info;
    if (!NT_SUCCESS(NtQueryInformationProcess(GetCurrentProcess(), ProcessBasicInformation, &info, sizeof(info), nullptr)))
        return -1;
    // winternl.h names InheritedFromUniqueProcessId "Reserved3".
    return static_cast<int32_t>(reinterpret_cast<uintptr_t>(info.Reserved3));
}

namespace Bun {

static int openProcess(int pid, DWORD access, HANDLE* handle)
{
    *handle = pid == 0 ? GetCurrentProcess() : OpenProcess(access, FALSE, static_cast<DWORD>(pid));
    if (*handle)
        return 0;

    DWORD error = GetLastError();
    // OpenProcess reports a pid that does not exist as ERROR_INVALID_PARAMETER.
    return error == ERROR_INVALID_PARAMETER ? UV__ESRCH : Bun__translateWin32ErrorToUV(error);
}

int getProcessPriority(int pid, int* priority)
{
    HANDLE handle;
    if (int err = openProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, &handle))
        return err;

    int result = 0;
    switch (GetPriorityClass(handle)) {
    case 0:
        result = Bun__translateWin32ErrorToUV(GetLastError());
        break;
    case REALTIME_PRIORITY_CLASS:
        *priority = -20;
        break;
    case HIGH_PRIORITY_CLASS:
        *priority = -14;
        break;
    case ABOVE_NORMAL_PRIORITY_CLASS:
        *priority = -7;
        break;
    case NORMAL_PRIORITY_CLASS:
        *priority = 0;
        break;
    case BELOW_NORMAL_PRIORITY_CLASS:
        *priority = 10;
        break;
    default: // IDLE_PRIORITY_CLASS
        *priority = 19;
        break;
    }

    CloseHandle(handle);
    return result;
}

int setProcessPriority(int pid, int priority)
{
    DWORD priorityClass;
    if (priority < -20 || priority > 19)
        return UV__EINVAL;
    else if (priority < -14)
        priorityClass = REALTIME_PRIORITY_CLASS;
    else if (priority < -7)
        priorityClass = HIGH_PRIORITY_CLASS;
    else if (priority < 0)
        priorityClass = ABOVE_NORMAL_PRIORITY_CLASS;
    else if (priority < 10)
        priorityClass = NORMAL_PRIORITY_CLASS;
    else if (priority < 19)
        priorityClass = BELOW_NORMAL_PRIORITY_CLASS;
    else
        priorityClass = IDLE_PRIORITY_CLASS;

    HANDLE handle;
    if (int err = openProcess(pid, PROCESS_SET_INFORMATION, &handle))
        return err;

    int result = 0;
    if (!SetPriorityClass(handle, priorityClass))
        result = Bun__translateWin32ErrorToUV(GetLastError());

    CloseHandle(handle);
    return result;
}

// FILETIME counts 100ns intervals.
static uint64_t fileTimeToMicroseconds(const FILETIME& time)
{
    return ((static_cast<uint64_t>(time.dwHighDateTime) << 32) | time.dwLowDateTime) / 10;
}

int getProcessCpuTimes(CpuTimes& times)
{
    FILETIME creation, exit, kernel, user;
    if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user))
        return Bun__translateWin32ErrorToUV(GetLastError());
    times.user = fileTimeToMicroseconds(user);
    times.system = fileTimeToMicroseconds(kernel);
    return 0;
}

int getThreadCpuTimes(CpuTimes& times)
{
    FILETIME creation, exit, kernel, user;
    if (!GetThreadTimes(GetCurrentThread(), &creation, &exit, &kernel, &user))
        return Bun__translateWin32ErrorToUV(GetLastError());
    times.user = fileTimeToMicroseconds(user);
    times.system = fileTimeToMicroseconds(kernel);
    return 0;
}

int getResourceUsage(ResourceUsage& usage)
{
    CpuTimes cpu;
    if (int err = getProcessCpuTimes(cpu))
        return err;

    PROCESS_MEMORY_COUNTERS memory;
    if (!GetProcessMemoryInfo(GetCurrentProcess(), &memory, sizeof(memory)))
        return Bun__translateWin32ErrorToUV(GetLastError());

    IO_COUNTERS io;
    if (!GetProcessIoCounters(GetCurrentProcess(), &io))
        return Bun__translateWin32ErrorToUV(GetLastError());

    usage = {};
    usage.ru_utime = { cpu.user / 1000000, cpu.user % 1000000 };
    usage.ru_stime = { cpu.system / 1000000, cpu.system % 1000000 };
    usage.ru_maxrss = memory.PeakWorkingSetSize / 1024;
    usage.ru_majflt = memory.PageFaultCount;
    usage.ru_inblock = io.ReadOperationCount;
    usage.ru_oublock = io.WriteOperationCount;
    return 0;
}

} // namespace Bun

#endif // OS(WINDOWS)
