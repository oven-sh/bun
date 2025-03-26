#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_send_buffer_size(uv_handle_t* handle, int* value) {
  __bun_throw_not_implemented("uv_send_buffer_size");
  __builtin_unreachable();
}

#endif