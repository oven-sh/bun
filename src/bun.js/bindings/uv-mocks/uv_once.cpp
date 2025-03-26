#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_once(uv_once_t* guard, void (*callback)(void)) {
  __bun_throw_not_implemented("uv_once");
  __builtin_unreachable();
}

#endif