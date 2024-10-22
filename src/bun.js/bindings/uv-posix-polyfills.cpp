#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)

uv_pid_t uv_os_getpid()
{
    return getpid();
}

uv_pid_t uv_os_getppid()
{
    return getppid();
}

#if OS(LINUX)
#include <time.h>

uint64_t uv_hrtime()
{
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000000000ULL + ts.tv_nsec;
}

#elif OS(DARWIN)
#include <mach/mach_time.h>
uint64_t uv_hrtime()
{
    return mach_absolute_time();
}
#endif

#endif
