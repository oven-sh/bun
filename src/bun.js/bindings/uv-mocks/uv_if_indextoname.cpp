#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_if_indextoname(unsigned int ifindex,
                                char* buffer,
                                size_t* size) {
  __bun_throw_not_implemented("uv_if_indextoname");
  __builtin_unreachable();
}

#endif