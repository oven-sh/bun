#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_prepare_stop(uv_prepare_t* prepare) {
  __bun_throw_not_implemented("uv_prepare_stop");
  __builtin_unreachable();
}

#endif