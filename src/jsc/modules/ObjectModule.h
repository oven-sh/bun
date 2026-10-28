#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSSourceCode.h>

namespace Zig {

// These create the source for a synthetic module that exports a JS value. The loader can instantiate the
// source zero or more times, so the value lives as long as the JSSourceCode.

// Exports the own enumerable string-keyed properties of `exports`.
JSC::JSSourceCode* createObjectModuleSourceCode(GlobalObject*, JSC::JSObject* exports, WTF::String&& sourceURL);

// Exports `value` as the default export. If it's a non-array object, its properties are also exported.
JSC::JSSourceCode* createJSValueModuleSourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

// Exports `value` as the default export and nothing else.
JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

// As above, without the `__esModule` marker.
JSC::JSSourceCode* createJSValueExportDefaultOnlySourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

} // namespace Zig
