#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_set_process_title(const char* title) {
  __bun_throw_not_implemented("uv_set_process_title");
  __builtin_unreachable();
}

#endif