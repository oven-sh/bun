#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace JSC {
class JSSourceCode;
}

namespace Zig {

// The loader runs a source's generator never, once, or again after the module left the registry: the value lives as long as the JSSourceCode.
JSC::JSSourceCode* createObjectModuleSourceCode(GlobalObject*, JSC::JSObject* object, WTF::String&& sourceURL);
JSC::JSSourceCode* createJSValueModuleSourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);
JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

} // namespace Zig
