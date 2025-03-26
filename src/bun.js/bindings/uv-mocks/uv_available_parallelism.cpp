#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

unsigned int uv_available_parallelism(void) {
  __bun_throw_not_implemented("uv_available_parallelism");
  __builtin_unreachable();
}

#endif