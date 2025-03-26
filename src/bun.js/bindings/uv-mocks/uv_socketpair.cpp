#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_socketpair(int type,
                            int protocol,
                            uv_os_sock_t socket_vector[2],
                            int flags0,
                            int flags1) {
  __bun_throw_not_implemented("uv_socketpair");
  __builtin_unreachable();
}

#endif