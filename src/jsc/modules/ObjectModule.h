#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace JSC {
class JSSourceCode;
}

namespace Zig {

// Fills in the exports from `source`. The return value means the same as JSC::SyntheticSourceProvider::LazySyntheticSourceGenerator's.
using SyntheticModuleGenerator = JSC::JSObject* (*)(JSC::JSValue source, JSC::JSGlobalObject*, const JSC::Identifier& moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues);

// The JSSourceCode keeps `source` alive. A JSC::Strong in the provider would leak both, because `source`'s global object
// holds the module registry, which holds the JSSourceCode.
JSC::JSSourceCode* createSyntheticSourceCode(JSC::VM&, JSC::JSValue source, SyntheticModuleGenerator, const WTF::String& moduleKey, bool hasLiveExports = false);

JSC::JSSourceCode* createObjectModuleSourceCode(JSC::VM&, JSC::JSObject* object, const WTF::String& moduleKey);

enum class NamedExports : bool { No,
    OfObject };
// `value` is the default export, unless `requireMap` has what require() has made of the same file by the time the module is made.
JSC::JSSourceCode* createDataModuleSourceCode(GlobalObject*, JSC::JSValue value, NamedExports, JSC::JSMap* requireMap, const WTF::String& moduleKey);

JSC::JSSourceCode* createJSValueExportDefaultObjectSourceCode(JSC::VM&, JSC::JSValue value, const WTF::String& moduleKey);

// As above, without the `__esModule` marker.
JSC::JSSourceCode* createJSValueExportDefaultOnlySourceCode(GlobalObject*, JSC::JSValue value, WTF::String&& sourceURL);

} // namespace Zig
