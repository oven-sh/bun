#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_inet_pton(int af, const char* src, void* dst) {
  __bun_throw_not_implemented("uv_inet_pton");
  __builtin_unreachable();
}

#endif