#pragma once

#define NAPI_VERBOSE 0

#if NAPI_VERBOSE
#include <stdio.h>
#include <stdarg.h>

#if defined __has_attribute
#if __has_attribute(__format__)
__attribute__((__format__(__printf__, 3, 4))) static inline void napi_log(long line, const char* function, const char* fmt, ...)
#endif
#endif
{
    printf("[napi.cpp:%ld] %s: ", line, function);

    va_list ap;
    va_start(ap, fmt);
    vprintf(fmt, ap);
    va_end(ap);

    printf("\n");
}

#define NAPI_LOG_CURRENT_FUNCTION printf("[napi.cpp:%d] %s\n", __LINE__, __PRETTY_FUNCTION__)
#define NAPI_LOG(fmt, ...) napi_log(__LINE__, __PRETTY_FUNCTION__, fmt __VA_OPT__(, ) __VA_ARGS__)
#else
#define NAPI_LOG_CURRENT_FUNCTION
#define NAPI_LOG(fmt, ...)
#endif
