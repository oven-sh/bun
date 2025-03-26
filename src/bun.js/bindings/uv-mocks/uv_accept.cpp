#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_accept(uv_stream_t* server, uv_stream_t* client)
{
    __bun_throw_not_implemented("uv_accept");
    __builtin_unreachable();
}

#endif
