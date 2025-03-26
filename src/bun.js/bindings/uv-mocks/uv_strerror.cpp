#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN const char* uv_strerror(int err) {
  __bun_throw_not_implemented("uv_strerror");
  __builtin_unreachable();
}

#endif