#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_unref(uv_handle_t*) {
  __bun_throw_not_implemented("uv_unref");
  __builtin_unreachable();
}

#endif