#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tty_get_winsize(uv_tty_t*, int* width, int* height) {
  __bun_throw_not_implemented("uv_tty_get_winsize");
  __builtin_unreachable();
}

#endif