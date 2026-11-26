#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

namespace Bun {

// `require("internal/weak_references")` in src/js.
JSC::JSValue createWeakReferenceFunctions(Zig::GlobalObject*);

} // namespace Bun
