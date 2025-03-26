#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN size_t uv_udp_get_send_queue_count(const uv_udp_t* handle) {
  __bun_throw_not_implemented("uv_udp_get_send_queue_count");
  __builtin_unreachable();
}

#endif