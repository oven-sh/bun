#pragma once

#ifndef LIBUWS_CAPI_HEADER
#define LIBUWS_CAPI_HEADER

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef STRING_POINTER
#define STRING_POINTER
typedef struct StringPointer {
    uint32_t off;
    uint32_t len;
} StringPointer;
#endif

#ifdef __cplusplus
extern "C" {
#endif

struct us_loop_t* uws_get_loop();

#ifdef __cplusplus
}
#endif

#endif
