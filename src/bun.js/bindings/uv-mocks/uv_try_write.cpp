#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_try_write(uv_stream_t* handle,
                           const uv_buf_t bufs[],
                           unsigned int nbufs) {
  __bun_throw_not_implemented("uv_try_write");
  __builtin_unreachable();
}

#endif