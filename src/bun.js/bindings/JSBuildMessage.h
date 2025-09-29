#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>

namespace Bun {

JSC::Structure* createBuildMessageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun

// These are called from Zig
extern "C" {
JSC::EncodedJSValue BuildMessage__toJS(void* buildMessage, JSC::JSGlobalObject* globalObject);
}
