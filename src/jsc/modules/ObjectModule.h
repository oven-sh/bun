#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Zig {
// `synthesizeDefault`: export `object` itself as `default` when it has no own
// `default` property, like the JSON and CommonJS module generators do.
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSObject* object, bool synthesizeDefault);

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCodeForJSON(JSC::JSGlobalObject* globalObject,
    JSC::JSObject* object);

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateJSValueModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value);

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateJSValueExportDefaultObjectSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value);

} // namespace Zig
