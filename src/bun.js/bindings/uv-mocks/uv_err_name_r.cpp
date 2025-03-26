#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

char* uv_err_name_r(int err, char* buf, size_t buflen) {
  __bun_throw_not_implemented("uv_err_name_r");
  __builtin_unreachable();
}

#endif