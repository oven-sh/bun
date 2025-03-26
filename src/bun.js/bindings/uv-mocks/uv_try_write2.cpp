#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_try_write2(uv_stream_t* handle,
                            const uv_buf_t bufs[],
                            unsigned int nbufs,
                            uv_stream_t* send_handle) {
  __bun_throw_not_implemented("uv_try_write2");
  __builtin_unreachable();
}

#endif