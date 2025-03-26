#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_random(uv_loop_t* loop,
                        uv_random_t* req,
                        void *buf,
                        size_t buflen,
                        unsigned flags,  /* For future extension must be 0. */
                        uv_random_cb cb); {
  __bun_throw_not_implemented("uv_random");
  __builtin_unreachable();
}

#endif