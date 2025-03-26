#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_sem_post(uv_sem_t* sem) {
  __bun_throw_not_implemented("uv_sem_post");
  __builtin_unreachable();
}

#endif