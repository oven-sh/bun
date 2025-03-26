#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_pending_count(uv_pipe_t* handle) {
  __bun_throw_not_implemented("uv_pipe_pending_count");
  __builtin_unreachable();
}

#endif