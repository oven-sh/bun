#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_interface_addresses(uv_interface_address_t** addresses,
                                     int* count) {
  __bun_throw_not_implemented("uv_interface_addresses");
  __builtin_unreachable();
}

#endif