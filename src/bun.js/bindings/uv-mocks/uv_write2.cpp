#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_write2(uv_write_t* req,
                        uv_stream_t* handle,
                        const uv_buf_t bufs[],
                        unsigned int nbufs,
                        uv_stream_t* send_handle,
                        uv_write_cb cb) {
  __bun_throw_not_implemented("uv_write2");
  __builtin_unreachable();
}

#endif