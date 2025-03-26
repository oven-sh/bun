#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_detach(uv_thread_t* tid) {
  __bun_throw_not_implemented("uv_thread_detach");
  __builtin_unreachable();
}

#endif