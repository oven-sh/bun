#include "uv-polyfills.h"

#include <stdint.h>
#include <stdlib.h>
#include <time.h>

uint64_t uv__hrtime(void)
{
    struct timespec t;

    if (clock_gettime(CLOCK_MONOTONIC, &t))
        abort();

    return t.tv_sec * (uint64_t)1e9 + t.tv_nsec;
}
