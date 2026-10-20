#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace JSC {
class JSSourceCode;
}

namespace Zig {

// The source of a module that exports a JS value. The loader makes a module from a source any
// number of times (none, or again once the module was removed from the registry), so the value
// lives as long as the source does.

// Each own enumerable property of `object` is an export.
JSC::JSSourceCode* createObjectModuleSourceCode(GlobalObject*, JSC::JSObject* object, WTF::String&& sourceURL);

// `value` is the default export. The properties of an object that is not an array are exports too.
JSC::JSSourceCode* createJSValueModuleSourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

// `value` is the default export.
JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

} // namespace Zig
