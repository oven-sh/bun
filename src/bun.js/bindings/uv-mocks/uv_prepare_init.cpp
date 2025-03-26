#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_prepare_init(uv_loop_t*, uv_prepare_t* prepare) {
  __bun_throw_not_implemented("uv_prepare_init");
  __builtin_unreachable();
}

#endif