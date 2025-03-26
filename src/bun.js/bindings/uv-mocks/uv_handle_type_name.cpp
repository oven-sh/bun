#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

const char* uv_handle_type_name(uv_handle_type type) {
  __bun_throw_not_implemented("uv_handle_type_name");
  __builtin_unreachable();
}

#endif