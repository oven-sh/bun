#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_pipe_connect(uv_connect_t* req,
                               uv_pipe_t* handle,
                               const char* name,
                               uv_connect_cb cb) {
  __bun_throw_not_implemented("uv_pipe_connect");
  __builtin_unreachable();
}

#endif