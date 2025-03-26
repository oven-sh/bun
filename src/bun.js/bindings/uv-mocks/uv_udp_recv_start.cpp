#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_recv_start(uv_udp_t* handle,
                                uv_alloc_cb alloc_cb,
                                uv_udp_recv_cb recv_cb) {
  __bun_throw_not_implemented("uv_udp_recv_start");
  __builtin_unreachable();
}

#endif