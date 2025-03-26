#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_prepare_start(uv_prepare_t* prepare, uv_prepare_cb cb) {
  __bun_throw_not_implemented("uv_prepare_start");
  __builtin_unreachable();
}

#endif