#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun {

void setupJSBuildMessageClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun

// These are called from Zig
extern "C" {
JSC::EncodedJSValue BuildMessage__toJS(void* buildMessage, JSC::JSGlobalObject* globalObject);
}
