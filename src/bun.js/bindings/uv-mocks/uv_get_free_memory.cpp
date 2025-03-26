#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uint64_t uv_get_free_memory(void) {
  __bun_throw_not_implemented("uv_get_free_memory");
  __builtin_unreachable();
}

#endif