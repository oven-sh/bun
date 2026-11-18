#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun::Bindgen {

// Has the members of a `global` interface without being a global object.
class JSGlobalStandIn : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;

    JSGlobalStandIn(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSC::JSNonFinalObject));
        return &vm.plainObjectSpace();
    }
};

// As receiverOfGlobal(), but it runs nothing. Null if there is none yet.
JSC::JSObject* existingReceiverOf(JSC::JSGlobalObject*, JSC::JSValue thisValue);
void setReceiverOf(JSC::VM&, JSC::JSObject* globalOrStandIn, JSC::JSObject* receiver);
// For a global object that gets its receiver when a member needs it. It may throw.
void setGlobalReceiverInitializer(void (*)(Zig::GlobalObject*));

}
