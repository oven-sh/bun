// The shared helper a prototype's [Symbol.for("nodejs.util.inspect.custom")] routes
// through so `console.log(x)` matches Node's `ClassName { field: value, ... }` shape.
// Named for its Web Streams origin; CryptoKey uses it too.
#pragma once

#include "root.h"

#include <JavaScriptCore/JSObject.h>

namespace Bun {
namespace WebStreams {

// Node's `customInspect(depth, options, name, data)` (lib/internal/webstreams/util.js):
// depth < 0 returns `thisValue`; otherwise `${name} ${inspect(data, {...options, depth-1})}`.
JSC::EncodedJSValue customInspect(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSValue thisValue, ASCIILiteral name, JSC::JSObject* data);
// Same, with a runtime-computed class name (subclass-aware inspectors).
JSC::EncodedJSValue customInspect(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSValue thisValue, const WTF::String& name, JSC::JSObject* data);
// getConstructorOf(obj).name (node lib/internal/util.js) with `fallback` when
// no named constructor is found on the prototype chain.
WTF::String constructorNameOf(JSC::JSGlobalObject*, JSC::JSValue thisValue, ASCIILiteral fallback);

// Installs the host function on a prototype under Symbol.for("nodejs.util.inspect.custom").
void installInspectCustom(JSC::VM&, JSC::JSObject* prototype, JSC::NativeFunction);

} // namespace WebStreams
} // namespace Bun
