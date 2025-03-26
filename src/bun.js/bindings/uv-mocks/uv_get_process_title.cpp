#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_get_process_title(char* buffer, size_t size) {
  __bun_throw_not_implemented("uv_get_process_title");
  __builtin_unreachable();
}

#endif