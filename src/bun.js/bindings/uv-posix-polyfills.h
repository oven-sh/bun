#pragma once

#include "root.h"

#if OS(LINUX) || OS(DARWIN)

typedef int uv_pid_t;

// Returns the current process ID.
extern "C" BUN_EXPORT uv_pid_t uv_os_getpid();

// Returns the parent process ID.
extern "C" BUN_EXPORT uv_pid_t uv_os_getppid();

// Returns the current high-resolution time in nanoseconds.
extern "C" BUN_EXPORT uint64_t uv_hrtime();

#endif
