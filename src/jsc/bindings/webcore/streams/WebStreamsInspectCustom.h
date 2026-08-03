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

// Installs the host function on a prototype under Symbol.for("nodejs.util.inspect.custom").
void installInspectCustom(JSC::VM&, JSC::JSObject* prototype, JSC::NativeFunction);

} // namespace WebStreams
} // namespace Bun
