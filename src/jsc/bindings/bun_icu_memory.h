#pragma once

#include "root.h"

namespace Bun {

// Makes a failed allocation inside ICU terminate through Bun__outOfMemory(); see the .cpp.
void installICUMemoryFunctions();

// Fails the ICU allocation after the next `skip` ones, as if malloc had returned null.
void failICUAllocationForTesting(size_t skip);

} // namespace Bun
