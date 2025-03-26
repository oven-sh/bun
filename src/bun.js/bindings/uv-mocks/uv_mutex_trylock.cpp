#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_mutex_trylock(uv_mutex_t* handle) {
  __bun_throw_not_implemented("uv_mutex_trylock");
  __builtin_unreachable();
}

#endif