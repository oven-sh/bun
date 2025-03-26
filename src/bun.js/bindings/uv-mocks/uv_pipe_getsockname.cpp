#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_getsockname(const uv_pipe_t* handle,
                                  char* buffer,
                                  size_t* size) {
  __bun_throw_not_implemented("uv_pipe_getsockname");
  __builtin_unreachable();
}

#endif