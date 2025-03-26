#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_ref(uv_handle_t*) {
  __bun_throw_not_implemented("uv_ref");
  __builtin_unreachable();
}

#endif