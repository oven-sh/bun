#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_bind(uv_pipe_t* handle, const char* name) {
  __bun_throw_not_implemented("uv_pipe_bind");
  __builtin_unreachable();
}

#endif