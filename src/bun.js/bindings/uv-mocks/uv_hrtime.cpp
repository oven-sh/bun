#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uint64_t uv_hrtime(void) {
  __bun_throw_not_implemented("uv_hrtime");
  __builtin_unreachable();
}

#endif