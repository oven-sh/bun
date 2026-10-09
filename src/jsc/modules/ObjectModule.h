#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace JSC {
class JSSourceCode;
}

namespace Zig {

// Fills in the exports of a module made from `source`. Returns what a JSC::SyntheticSourceProvider::LazySyntheticSourceGenerator does.
using SyntheticModuleGenerator = JSC::JSObject* (*)(JSC::JSValue source, JSC::JSGlobalObject*, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues);

// `source` is kept alive by the JSSourceCode. Were it by a JSC::Strong of the provider's, neither would ever be collected: the
// module registry keeps the JSSourceCode, and the global object of `source` the registry.
JSC::JSSourceCode* createSyntheticSourceCode(JSC::VM&, JSC::JSValue source, SyntheticModuleGenerator, const WTF::String& moduleKey, bool hasLiveExports = false);

// The exports are the properties of `object`.
JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM&, JSC::JSObject* object, const WTF::String& moduleKey);

// `value` is the default export, and its properties, unless it is an array, are exports too.
JSC::JSSourceCode* createJSValueModuleSourceCode(JSC::VM&, JSC::JSValue value, const WTF::String& moduleKey);

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM&, JSC::JSValue value, const WTF::String& moduleKey);

} // namespace Zig
