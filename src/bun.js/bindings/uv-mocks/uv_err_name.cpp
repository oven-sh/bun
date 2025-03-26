#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

const char* uv_err_name(int err) {
  __bun_throw_not_implemented("uv_err_name");
  __builtin_unreachable();
}

#endif