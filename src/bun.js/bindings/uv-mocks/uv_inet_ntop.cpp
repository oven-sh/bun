#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_inet_ntop(int af, const void* src, char* dst, size_t size) {
  __bun_throw_not_implemented("uv_inet_ntop");
  __builtin_unreachable();
}

#endif