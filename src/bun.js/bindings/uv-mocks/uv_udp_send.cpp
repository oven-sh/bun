#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_send(uv_udp_send_t* req,
                          uv_udp_t* handle,
                          const uv_buf_t bufs[],
                          unsigned int nbufs,
                          const struct sockaddr* addr,
                          uv_udp_send_cb send_cb) {
  __bun_throw_not_implemented("uv_udp_send");
  __builtin_unreachable();
}

#endif