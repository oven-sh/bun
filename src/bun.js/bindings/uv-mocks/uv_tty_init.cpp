#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tty_init(uv_loop_t*, uv_tty_t*, uv_file fd, int readable) {
  __bun_throw_not_implemented("uv_tty_init");
  __builtin_unreachable();
}

#endif