#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun {

void setupJSResolveMessageClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun

// These are called from Zig
extern "C" {
JSC::EncodedJSValue ResolveMessage__toJS(void* resolveMessage, JSC::JSGlobalObject* globalObject);
}
