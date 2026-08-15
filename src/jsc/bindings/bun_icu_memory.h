#pragma once

#include "root.h"

namespace Bun {

// Points ICU's heap functions at malloc/realloc/free wrappers that die through
// Bun__outOfMemory() instead of handing ICU a null pointer. Called once from
// JSCInitialize; a no-op on Darwin, where ICU is the system libicucore.
void installICUMemoryFunctions();

// Test hook: after letting `skip` more ICU allocations succeed, fail the next
// one exactly as if malloc had returned null.
void failICUAllocationForTesting(size_t skip);

} // namespace Bun
