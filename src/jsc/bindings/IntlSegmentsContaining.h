#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

void installIntlSegmentsContainingFix(Zig::GlobalObject*, JSC::VM&);

} // namespace Bun
