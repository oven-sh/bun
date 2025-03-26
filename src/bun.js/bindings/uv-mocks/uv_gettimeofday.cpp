#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_gettimeofday(uv_timeval64_t* tv) {
  __bun_throw_not_implemented("uv_gettimeofday");
  __builtin_unreachable();
}

#endif