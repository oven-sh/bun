#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_free_cpu_info(uv_cpu_info_t* cpu_infos, int count) {
  __bun_throw_not_implemented("uv_free_cpu_info");
  __builtin_unreachable();
}

#endif