#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_pipe_pending_instances(uv_pipe_t* handle, int count) {
  __bun_throw_not_implemented("uv_pipe_pending_instances");
  __builtin_unreachable();
}

#endif