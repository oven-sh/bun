#pragma once

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>

namespace Bun {
JSC::JSObject* createNodeV8Binding(JSC::JSGlobalObject* globalObject);
}
