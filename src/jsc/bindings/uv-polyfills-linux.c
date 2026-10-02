
#include "uv-polyfills.h"
#include <time.h>

uint64_t uv__hrtime(void)
{
    struct timespec t;

    if (clock_gettime(CLOCK_MONOTONIC, &t))
        return 0; /* Not really possible. */

    return t.tv_sec * (uint64_t)1e9 + t.tv_nsec;
}
