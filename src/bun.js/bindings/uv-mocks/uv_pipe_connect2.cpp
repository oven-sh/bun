#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_connect2(uv_connect_t* req,
                               uv_pipe_t* handle,
                               const char* name,
                               size_t namelen,
                               unsigned int flags,
                               uv_connect_cb cb) {
  __bun_throw_not_implemented("uv_pipe_connect2");
  __builtin_unreachable();
}

#endif