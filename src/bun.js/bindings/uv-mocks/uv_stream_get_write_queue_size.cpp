#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN size_t uv_stream_get_write_queue_size(const uv_stream_t* stream) {
  __bun_throw_not_implemented("uv_stream_get_write_queue_size");
  __builtin_unreachable();
}

#endif