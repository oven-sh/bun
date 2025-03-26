#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_tty_set_vterm_state(uv_tty_vtermstate_t state) {
  __bun_throw_not_implemented("uv_tty_set_vterm_state");
  __builtin_unreachable();
}

#endif