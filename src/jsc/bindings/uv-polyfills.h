#pragma once

#include "root.h"
#include <stdint.h>
#include <stdio.h>

// These functions are called by the stubs to crash with a nice error message
// when accessing a libuv function which we do not support
void CrashHandler__unsupportedUVFunction(const char* function_name);
void __bun_throw_not_implemented(const char* symbol_name);

#if OS(WINDOWS)
// Exported through src/symbols.def.
#define UV_EXTERN
#else
#define UV_EXTERN __attribute__((visibility("default"))) __attribute__((used))
#endif

#include <uv/errno.h>

// The types of the functions Bun implements, as uv/win.h and uv/unix.h define
// them. An addon is compiled against Node's copy of those.
#if OS(WINDOWS)
#include <windows.h>
typedef int uv_pid_t;
typedef CRITICAL_SECTION uv_mutex_t;
typedef struct uv_once_s {
    unsigned char unused;
    INIT_ONCE init_once;
} uv_once_t;
#else
#include <pthread.h>
#include <sys/types.h>
typedef pid_t uv_pid_t;
typedef pthread_mutex_t uv_mutex_t;
typedef pthread_once_t uv_once_t;
#define UV_ONCE_INIT PTHREAD_ONCE_INIT
#endif

typedef enum {
    UV_CLOCK_PRECISE = 0, /* Use the highest resolution clock available. */
    UV_CLOCK_FAST = 1 /* Use the fastest clock with <= 1ms granularity. */
} uv_clocktype_t;
