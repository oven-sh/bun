#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_set_source_membership(uv_udp_t* handle,
                                           const char* multicast_addr,
                                           const char* interface_addr,
                                           const char* source_addr,
                                           uv_membership membership) {
  __bun_throw_not_implemented("uv_udp_set_source_membership");
  __builtin_unreachable();
}

#endif