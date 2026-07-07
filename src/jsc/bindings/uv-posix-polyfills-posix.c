#include "uv-posix-polyfills.h"

#include <stdint.h>
#include <stdlib.h>
#include <time.h>

uint64_t uv__hrtime(uv_clocktype_t type)
{
    struct timespec t;

    if (clock_gettime(CLOCK_MONOTONIC, &t))
        abort();

    return t.tv_sec * (uint64_t)1e9 + t.tv_nsec;
}
