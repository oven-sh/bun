#include "bun.h"
#include "uv.h"

#if OS(WINDOWS)
#include "uv.h"
#endif

namespace Bun {

uint64_t hrtime()
{
    return uv_hrtime();
}

} // namespace Bun
