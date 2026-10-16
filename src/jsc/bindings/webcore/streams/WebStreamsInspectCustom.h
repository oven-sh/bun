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

// Methods with a native half, which copies native state, and a JS half: internal/util/inspect_hooks.

// The native formatter (ConsoleObject.rs) does not call or list them. These are the ones from *.classes.ts files.
extern const JSC::NativeFunction generatedNodeOnlyInspectHooks[];
extern const size_t generatedNodeOnlyInspectHookCount;

// `this` as a method sees it (undefined for a bare call), or the target when that is a Proxy. Null when not an object.
JSC::JSObject* inspectHolder(JSC::JSGlobalObject*, JSC::CallFrame*);
// The first instance of the class on the prototype chain of `holder`, found with no user code. A Proxy ends the search.
JSC::JSObject* findInspectInstance(JSC::JSObject* holder, const JSC::ClassInfo*);
template<typename JSClass> JSClass* inspectInstance(JSC::JSObject* holder)
{
    return static_cast<JSClass*>(findInspectInstance(holder, JSClass::info()));
}
// Calls the JS half with `fields`, the state of `instance`. Both are null when the receiver holds no instance.
JSC::EncodedJSValue inspectFields(JSC::JSGlobalObject*, JSC::CallFrame*, ASCIILiteral tag, JSC::JSObject* fields, JSC::JSObject* instance);

} // namespace WebStreams
} // namespace Bun
