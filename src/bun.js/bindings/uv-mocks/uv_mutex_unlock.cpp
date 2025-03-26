#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_mutex_unlock(uv_mutex_t* handle) {
  __bun_throw_not_implemented("uv_mutex_unlock");
  __builtin_unreachable();
}

#endif