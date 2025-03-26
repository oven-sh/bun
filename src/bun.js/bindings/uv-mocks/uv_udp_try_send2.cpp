#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_try_send2(uv_udp_t* handle,
                               unsigned int count,
                               uv_buf_t* bufs[/*count*/],
                               unsigned int nbufs[/*count*/],
                               struct sockaddr* addrs[/*count*/],
                               unsigned int flags) {
  __bun_throw_not_implemented("uv_udp_try_send2");
  __builtin_unreachable();
}

#endif