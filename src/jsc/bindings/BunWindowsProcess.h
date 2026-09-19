#pragma once

#include "root.h"

#if OS(WINDOWS)

// A Win32 error code as the negative UV_E* number JS sees in `err.errno`.
extern "C" int Bun__translateWin32ErrorToUV(uint32_t win32Error);

extern "C" int32_t Bun__getParentProcessId();

namespace Bun {

// Every function returning `int` returns 0 or a negative UV_E* number.

// `pid` 0 is the current process. Priorities are Unix nice values; see
// os.constants.priority.
int getProcessPriority(int pid, int* priority);
int setProcessPriority(int pid, int priority);

// Microseconds.
struct CpuTimes {
    uint64_t user;
    uint64_t system;
};
int getProcessCpuTimes(CpuTimes&);
int getThreadCpuTimes(CpuTimes&);

// `struct rusage` for process.resourceUsage(). Windows has a source for
// ru_utime, ru_stime, ru_maxrss (kilobytes), ru_majflt (every page fault, soft
// or hard) and ru_inblock/ru_oublock (I/O operations); the rest is 0.
struct ResourceUsage {
    struct {
        uint64_t tv_sec;
        uint64_t tv_usec;
    } ru_utime, ru_stime;
    uint64_t ru_maxrss, ru_ixrss, ru_idrss, ru_isrss, ru_minflt, ru_majflt, ru_nswap, ru_inblock, ru_oublock, ru_msgsnd, ru_msgrcv, ru_nsignals, ru_nvcsw, ru_nivcsw;
};
int getResourceUsage(ResourceUsage&);

} // namespace Bun

#endif // OS(WINDOWS)
