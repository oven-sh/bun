#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_poll_init_socket(uv_loop_t* loop,
                                  uv_poll_t* handle,
                                  uv_os_sock_t socket) {
  __bun_throw_not_implemented("uv_poll_init_socket");
  __builtin_unreachable();
}

#endif