#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace JSC {
class JSSourceCode;
}

namespace Zig {

// Fills in the exports from `source`. The return value means the same as JSC::SyntheticSourceProvider::LazySyntheticSourceGenerator's.
using SyntheticModuleGenerator = JSC::JSObject* (*)(JSC::JSValue source, JSC::JSGlobalObject*, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues);

// The JSSourceCode keeps `source` alive. A JSC::Strong in the provider would leak both, because `source`'s global object
// holds the module registry, which holds the JSSourceCode.
JSC::JSSourceCode* createSyntheticSourceCode(JSC::VM&, JSC::JSValue source, SyntheticModuleGenerator, const WTF::String& moduleKey, bool hasLiveExports = false);

JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM&, JSC::JSObject* object, const WTF::String& moduleKey);

// `value` is the default export. Unless it's an array, its properties are named exports too.
JSC::JSSourceCode* createJSValueModuleSourceCode(JSC::VM&, JSC::JSValue value, const WTF::String& moduleKey);

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM&, JSC::JSValue value, const WTF::String& moduleKey);

} // namespace Zig
