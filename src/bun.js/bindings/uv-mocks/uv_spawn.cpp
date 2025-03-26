#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_spawn(uv_loop_t* loop,
                       uv_process_t* handle,
                       const uv_process_options_t* options) {
  __bun_throw_not_implemented("uv_spawn");
  __builtin_unreachable();
}

#endif