#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_utf16_to_wtf8(const uint16_t* utf16,
                               ssize_t utf16_len,
                               char** wtf8_ptr,
                               size_t* wtf8_len_ptr) {
  __bun_throw_not_implemented("uv_utf16_to_wtf8");
  __builtin_unreachable();
}

#endif