#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSSourceCode.h>

namespace Zig {

// The source of a synthetic module that exports a JS value. The loader reads the exports from the value each time
// it makes a module from the source, which it does never, once, or more than once, so the JSSourceCode holds the value
// (JSC::JSSourceCode::createWithPayload).

// The own enumerable string-keyed properties of `exports` are the exports.
JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM&, JSC::JSObject* exports, WTF::String&& sourceURL);

// `value` is the default export. When it is an object that is not an array, its properties are exports as well.
JSC::JSSourceCode* createJSValueModuleSourceCode(JSC::VM&, JSC::JSValue value, WTF::String&& sourceURL);

// `value` is the default export, and the only one.
JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM&, JSC::JSValue value, WTF::String&& sourceURL);

} // namespace Zig
