#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_sem_init(uv_sem_t* sem, unsigned int value) {
  __bun_throw_not_implemented("uv_sem_init");
  __builtin_unreachable();
}

#endif