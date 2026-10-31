#pragma once
#include "root.h"

namespace Bun {

// `path.dirname(path)`, with its errors.
JSC::JSValue pathDirname(JSC::JSGlobalObject*, JSC::JSValue path);

// `path.resolve(path)`, with its errors. `path.win32.resolve()` gives an error in place of a root that is too long.
JSC::JSValue pathResolve(JSC::JSGlobalObject*, JSC::JSString* path);

} // namespace Bun
