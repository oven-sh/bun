#pragma once

#include "root.h"

namespace Bun {

// Exposed through `bun:internal-for-testing`: materializes every JSC
// primordial link-time constant and returns their manifest and values.
BUN_DECLARE_HOST_FUNCTION(Bun__primordialsAudit);

} // namespace Bun
