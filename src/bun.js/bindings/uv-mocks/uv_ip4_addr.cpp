#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_ip4_addr(const char* ip, int port, struct sockaddr_in* addr)
{
    __bun_throw_not_implemented("uv_ip4_addr");
    __builtin_unreachable();
}

#endif
