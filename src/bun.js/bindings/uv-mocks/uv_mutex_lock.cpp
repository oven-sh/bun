#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_mutex_lock(uv_mutex_t* handle) {
  __bun_throw_not_implemented("uv_mutex_lock");
  __builtin_unreachable();
}

#endif