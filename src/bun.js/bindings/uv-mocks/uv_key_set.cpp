#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_key_set(uv_key_t* key, void* value) {
  __bun_throw_not_implemented("uv_key_set");
  __builtin_unreachable();
}

#endif