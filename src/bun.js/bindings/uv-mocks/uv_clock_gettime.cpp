#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_clock_gettime(uv_clock_id clock_id, uv_timespec64_t* ts) {
  __bun_throw_not_implemented("uv_clock_gettime");
  __builtin_unreachable();
}

#endif