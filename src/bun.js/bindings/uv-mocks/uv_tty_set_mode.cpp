#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tty_set_mode(uv_tty_t*, uv_tty_mode_t mode) {
  __bun_throw_not_implemented("uv_tty_set_mode");
  __builtin_unreachable();
}

#endif