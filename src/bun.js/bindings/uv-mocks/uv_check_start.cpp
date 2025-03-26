#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_check_start(uv_check_t* check, uv_check_cb cb) {
  __bun_throw_not_implemented("uv_check_start");
  __builtin_unreachable();
}

#endif