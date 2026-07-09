// WebStreamsInspectCustom.h — the one shared helper every Web Streams prototype's
// [Symbol.for("nodejs.util.inspect.custom")] host function routes through, so
// `console.log(stream)` matches Node's output shape: `ClassName { field: value, ... }`.
#pragma once

#include "root.h"

#include <JavaScriptCore/JSObject.h>

namespace Bun {
namespace WebStreams {

// Node's `customInspect(depth, options, name, data)` (lib/internal/webstreams/util.js):
//   if (depth < 0) return this;
//   const opts = { ...options, depth: options.depth == null ? null : options.depth - 1 };
//   return `${name} ${inspect(data, opts)}`;
// `thisValue` is returned when depth < 0; `data` is the pre-built field object.
JSC::EncodedJSValue customInspect(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSValue thisValue, ASCIILiteral name, JSC::JSObject* data);

// Installs the host function on a prototype under Symbol.for("nodejs.util.inspect.custom").
void installInspectCustom(JSC::VM&, JSC::JSObject* prototype, JSC::NativeFunction);

} // namespace WebStreams
} // namespace Bun
