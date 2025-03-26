#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_handle_type uv_guess_handle(uv_file file) {
  __bun_throw_not_implemented("uv_guess_handle");
  __builtin_unreachable();
}

#endif