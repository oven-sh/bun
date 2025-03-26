#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_handle_type uv_handle_get_type(const uv_handle_t* handle) {
  __bun_throw_not_implemented("uv_handle_get_type");
  __builtin_unreachable();
}

#endif