#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_is_closing(const uv_handle_t* handle) {
  __bun_throw_not_implemented("uv_is_closing");
  __builtin_unreachable();
}

#endif