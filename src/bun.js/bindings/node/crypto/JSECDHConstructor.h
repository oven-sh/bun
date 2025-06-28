#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(callECDH);
JSC_DECLARE_HOST_FUNCTION(constructECDH);

class JSECDHConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSECDHConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSECDHConstructor* constructor = new (NotNull, JSC::allocateCell<JSECDHConstructor>(vm)) JSECDHConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSECDHConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callECDH, constructECDH)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);
};

} // namespace Bun
