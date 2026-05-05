
#include "uv-posix-polyfills.h"
#include <stdatomic.h>
#include <time.h>
#include <unistd.h>

uint64_t uv__hrtime(uv_clocktype_t type)
{
    static _Atomic clock_t fast_clock_id = -1;
    struct timespec t;
    clock_t clock_id;

    /* Prefer CLOCK_MONOTONIC_COARSE if available but only when it has
     * millisecond granularity or better.  CLOCK_MONOTONIC_COARSE is
     * serviced entirely from the vDSO, whereas CLOCK_MONOTONIC may
     * decide to make a costly system call.
     */
    /* TODO(bnoordhuis) Use CLOCK_MONOTONIC_COARSE for UV_CLOCK_PRECISE
     * when it has microsecond granularity or better (unlikely).
     */
    clock_id = CLOCK_MONOTONIC;
    if (type != UV_CLOCK_FAST)
        goto done;

    clock_id = atomic_load_explicit(&fast_clock_id, memory_order_relaxed);
    if (clock_id != -1)
        goto done;

    clock_id = CLOCK_MONOTONIC;
    if (0 == clock_getres(CLOCK_MONOTONIC_COARSE, &t))
        if (t.tv_nsec <= 1 * 1000 * 1000)
            clock_id = CLOCK_MONOTONIC_COARSE;

    atomic_store_explicit(&fast_clock_id, clock_id, memory_order_relaxed);

done:

    if (clock_gettime(clock_id, &t))
        return 0; /* Not really possible. */

    return t.tv_sec * (uint64_t)1e9 + t.tv_nsec;
}
