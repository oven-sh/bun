#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_buf_t uv_buf_init(char* base, unsigned int len) {
  __bun_throw_not_implemented("uv_buf_init");
  __builtin_unreachable();
}

#endif