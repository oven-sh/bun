#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN size_t uv_utf16_length_as_wtf8(const uint16_t* utf16,
                                         ssize_t utf16_len) {
  __bun_throw_not_implemented("uv_utf16_length_as_wtf8");
  __builtin_unreachable();
}

#endif