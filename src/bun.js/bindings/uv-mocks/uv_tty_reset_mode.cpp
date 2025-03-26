#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tty_reset_mode(void) {
  __bun_throw_not_implemented("uv_tty_reset_mode");
  __builtin_unreachable();
}

#endif