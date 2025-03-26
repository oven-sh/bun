#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_wtf8_to_utf16(const char* wtf8,
                                uint16_t* utf16,
                                size_t utf16_len) {
  __bun_throw_not_implemented("uv_wtf8_to_utf16");
  __builtin_unreachable();
}

#endif