#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_chmod(uv_pipe_t* handle, int flags) {
  __bun_throw_not_implemented("uv_pipe_chmod");
  __builtin_unreachable();
}

#endif