#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN char** uv_setup_args(int argc, char** argv) {
  __bun_throw_not_implemented("uv_setup_args");
  __builtin_unreachable();
}

#endif