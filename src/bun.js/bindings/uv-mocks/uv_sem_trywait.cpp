#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_sem_trywait(uv_sem_t* sem) {
  __bun_throw_not_implemented("uv_sem_trywait");
  __builtin_unreachable();
}

#endif