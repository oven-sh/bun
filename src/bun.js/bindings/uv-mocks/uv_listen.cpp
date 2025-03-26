#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_listen(uv_stream_t* stream, int backlog, uv_connection_cb cb) {
  __bun_throw_not_implemented("uv_listen");
  __builtin_unreachable();
}

#endif