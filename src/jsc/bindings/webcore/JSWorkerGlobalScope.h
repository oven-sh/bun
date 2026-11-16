// The WorkerGlobalScope and DedicatedWorkerGlobalScope interfaces of a Web Worker's global object.
// https://html.spec.whatwg.org/multipage/workers.html#the-workerglobalscope-common-interface
//
// The global object of a Web Worker (WorkerOptions::Kind::Web) is the DedicatedWorkerGlobalScope instance:
// installWorkerGlobalScope() puts DedicatedWorkerGlobalScope.prototype (above it WorkerGlobalScope.prototype,
// then EventTarget.prototype) on the global's prototype chain and the constructors on the global. Both
// constructors throw "Illegal constructor". Neither has an instance cell of its own.
#pragma once

#include "root.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class JSWorkerGlobalScope final {
public:
    // WorkerGlobalScope.prototype of the worker's realm.
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
};

class JSDedicatedWorkerGlobalScope final {
public:
    // DedicatedWorkerGlobalScope.prototype of the worker's realm: the prototype of its global object.
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
};

using JSWorkerGlobalScopeConstructor = JSDOMConstructorNotConstructable<JSWorkerGlobalScope>;
using JSDedicatedWorkerGlobalScopeConstructor = JSDOMConstructorNotConstructable<JSDedicatedWorkerGlobalScope>;

// Makes the global object of a Web Worker a DedicatedWorkerGlobalScope. Call it once, before any script runs in it.
void installWorkerGlobalScope(Zig::GlobalObject*);

} // namespace WebCore
