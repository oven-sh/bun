#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN char* uv_strerror_r(int err, char* buf, size_t buflen) {
  __bun_throw_not_implemented("uv_strerror_r");
  __builtin_unreachable();
}

#endif