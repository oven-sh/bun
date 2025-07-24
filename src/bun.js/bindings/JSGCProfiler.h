#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun {

class JSGCProfiler;

void setupGCProfilerClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun

JSC::JSValue createGCProfilerFunctions(Zig::GlobalObject* globalObject);