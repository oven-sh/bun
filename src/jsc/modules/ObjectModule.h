#pragma once

#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Zig {
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSObject* object);

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateObjectModuleSourceCodeForJSON(JSC::JSGlobalObject* globalObject,
    JSC::JSObject* object);

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateJSValueModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value);

JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateJSValueExportDefaultObjectSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value);

// JSON / TOML / JSONC modules when module graph instances are enabled: the
// first generation exports the parsed value, every later one (another graph)
// a fresh copy of it, so each graph's data module is its own.
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generateDataModuleSourceCode(JSC::JSGlobalObject* globalObject,
    JSC::JSValue value);

} // namespace Zig
