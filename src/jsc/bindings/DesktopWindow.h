#pragma once

#include "root.h"

namespace Bun {

// The exotic objects of the windows of `bun:desktop`.
bool isRemoteWindow(JSC::JSGlobalObject*);
bool isRemoteLocation(JSC::JSObject*);
JSC::JSObject* createWindowProperties(JSC::JSGlobalObject*, JSC::JSValue prototype);

} // namespace Bun
