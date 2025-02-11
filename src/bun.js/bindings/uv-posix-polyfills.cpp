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

#endif
