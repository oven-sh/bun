#include "bun.h"

#if OS(WINDOWS)
#include "uv.h"
#endif

namespace Bun {

uint64_t now()
{
#if OS(WINDOWS)
    return uv_hrtime();
#else
    // TODO: TODO!
    return 0;
#endif
}

} // namespace Bun
