#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>

namespace Bun {

JSC::Structure* createResolveMessageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun

// These are called from Zig
extern "C" {
JSC::EncodedJSValue ResolveMessage__toJS(void* resolveMessage, JSC::JSGlobalObject* globalObject);
}
