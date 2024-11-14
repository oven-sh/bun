#pragma once

#include "root.h"

#if OS(LINUX) || OS(DARWIN)

typedef int uv_pid_t;

// Returns the current process ID.
extern "C" BUN_EXPORT uv_pid_t uv_os_getpid();

// Returns the parent process ID.
extern "C" BUN_EXPORT uv_pid_t uv_os_getppid();

#endif
