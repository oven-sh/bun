#pragma once

#include "root.h"
#include <stdint.h>
#include <stdio.h>

#if OS(LINUX) || OS(DARWIN)

// These functions are called by the stubs to crash with a nice error message
// when accessing a libuv functin which we do not support on posix
extern "C" void CrashHandler__unsupportedUVFunction(const char* function_name);
void __bun_throw_not_implemented(const char* symbol_name);

// libuv headers will use UV_EXTERN
#define UV_EXTERN extern "C" __attribute__((visibility("default"))) __attribute__((used))

#include <uv.h>

#endif
