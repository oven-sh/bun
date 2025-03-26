#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

size_t uv_handle_size(uv_handle_type type) {
  __bun_throw_not_implemented("uv_handle_size");
  __builtin_unreachable();
}

#endif