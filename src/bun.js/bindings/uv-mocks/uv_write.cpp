#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_write(uv_write_t* req,
                       uv_stream_t* handle,
                       const uv_buf_t bufs[],
                       unsigned int nbufs,
                       uv_write_cb cb) {
  __bun_throw_not_implemented("uv_write");
  __builtin_unreachable();
}

#endif