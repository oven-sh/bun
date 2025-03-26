#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_close(uv_handle_t* handle, uv_close_cb close_cb) {
  __bun_throw_not_implemented("uv_close");
  __builtin_unreachable();
}

#endif