#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void* uv_handle_get_data(const uv_handle_t* handle) {
  __bun_throw_not_implemented("uv_handle_get_data");
  __builtin_unreachable();
}

#endif