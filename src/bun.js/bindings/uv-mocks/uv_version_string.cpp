#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN const char* uv_version_string(void) {
  __bun_throw_not_implemented("uv_version_string");
  __builtin_unreachable();
}

#endif