#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_resident_set_memory(size_t* rss) {
  __bun_throw_not_implemented("uv_resident_set_memory");
  __builtin_unreachable();
}

#endif