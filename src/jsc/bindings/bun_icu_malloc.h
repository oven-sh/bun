#pragma once

#include "root.h"

namespace Bun {

// () => { installed: boolean, allocations: number }
BUN_DECLARE_HOST_FUNCTION(Bun__icuAllocatorForTesting);

} // namespace Bun
