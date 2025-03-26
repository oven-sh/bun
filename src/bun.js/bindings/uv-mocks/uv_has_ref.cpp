#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_has_ref(const uv_handle_t* handle) {
  __bun_throw_not_implemented("uv_has_ref");
  __builtin_unreachable();
}

#endif