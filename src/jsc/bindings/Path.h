#pragma once
#include "root.h"

namespace Bun {

// `path.dirname(path)`, with its errors.
JSC::JSValue pathDirname(JSC::JSGlobalObject*, JSC::JSValue path);

// `path.join(first, second)`, with its errors.
JSC::JSValue pathJoin(JSC::JSGlobalObject*, JSC::JSString* first, JSC::JSString* second);

} // namespace Bun
