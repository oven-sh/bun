#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uv_handle_type uv_pipe_pending_type(uv_pipe_t* handle) {
  __bun_throw_not_implemented("uv_pipe_pending_type");
  __builtin_unreachable();
}

#endif