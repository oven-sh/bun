#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_set_multicast_interface(uv_udp_t* handle,
                                             const char* interface_addr) {
  __bun_throw_not_implemented("uv_udp_set_multicast_interface");
  __builtin_unreachable();
}

#endif