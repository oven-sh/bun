#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_mutex_destroy(uv_mutex_t* handle) {
  __bun_throw_not_implemented("uv_mutex_destroy");
  __builtin_unreachable();
}

#endif