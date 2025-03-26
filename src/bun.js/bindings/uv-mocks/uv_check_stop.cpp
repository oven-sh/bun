#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_check_stop(uv_check_t* check) {
  __bun_throw_not_implemented("uv_check_stop");
  __builtin_unreachable();
}

#endif