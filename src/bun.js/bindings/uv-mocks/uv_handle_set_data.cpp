#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_handle_set_data(uv_handle_t* handle, void* data) {
  __bun_throw_not_implemented("uv_handle_set_data");
  __builtin_unreachable();
}

#endif