// WorkerGlobalScope and DedicatedWorkerGlobalScope: the global object of a Web Worker is the instance.
// https://html.spec.whatwg.org/multipage/workers.html#the-workerglobalscope-common-interface
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

// Puts the scope prototypes above the global object and the constructors on it. Before any script runs.
void installWorkerGlobalScope(Zig::GlobalObject*);

} // namespace WebCore
