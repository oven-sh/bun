#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_print_all_handles(uv_loop_t* loop, FILE* stream) {
  __bun_throw_not_implemented("uv_print_all_handles");
  __builtin_unreachable();
}

#endif