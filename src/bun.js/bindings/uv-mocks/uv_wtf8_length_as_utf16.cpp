#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN ssize_t uv_wtf8_length_as_utf16(const char* wtf8) {
  __bun_throw_not_implemented("uv_wtf8_length_as_utf16");
  __builtin_unreachable();
}

#endif