#pragma once

#include "root.h"
#include <stdint.h>
#include <stdio.h>

#if OS(LINUX) || OS(DARWIN) || OS(FREEBSD) || OS(WINDOWS)

// These functions are called by the stubs to crash with a nice error message
// when accessing a libuv functin which we do not support on posix
void CrashHandler__unsupportedUVFunction(const char* function_name);
void __bun_throw_not_implemented(const char* symbol_name);

// libuv headers will use UV_EXTERN
#if OS(WINDOWS)
#define UV_EXTERN /* static-link export; named in symbols.def */
#else
#define UV_EXTERN __attribute__((visibility("default"))) __attribute__((used))
#endif

#include <uv.h>

typedef enum {
    UV_CLOCK_PRECISE = 0, /* Use the highest resolution clock available. */
    UV_CLOCK_FAST = 1 /* Use the fastest clock with <= 1ms granularity. */
} uv_clocktype_t;

#endif
