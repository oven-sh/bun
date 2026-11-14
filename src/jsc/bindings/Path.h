#pragma once
#include "root.h"

namespace Bun {

// `path.dirname(path)`, with its errors.
JSC::JSValue pathDirname(JSC::JSGlobalObject*, JSC::JSValue path);

} // namespace Bun
