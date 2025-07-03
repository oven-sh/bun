
#include "uv-posix-polyfills.h"
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <stdlib.h>

static uv_once_t once = UV_ONCE_INIT;
static mach_timebase_info_data_t timebase;

static void uv__hrtime_init_once(void)
{
    if (KERN_SUCCESS != mach_timebase_info(&timebase))
        abort();
}

uint64_t uv__hrtime(uv_clocktype_t type)
{
    uv_once(&once, uv__hrtime_init_once);
    return mach_continuous_time() * timebase.numer / timebase.denom;
}
