#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_bind2(uv_pipe_t* handle,
                            const char* name,
                            size_t namelen,
                            unsigned int flags) {
  __bun_throw_not_implemented("uv_pipe_bind2");
  __builtin_unreachable();
}

#endif