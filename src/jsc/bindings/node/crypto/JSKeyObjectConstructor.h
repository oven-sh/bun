#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(callKeyObject);
JSC_DECLARE_HOST_FUNCTION(constructKeyObject);

class JSKeyObjectConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSKeyObjectConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSKeyObjectConstructor* constructor = new (NotNull, JSC::allocateCell<JSKeyObjectConstructor>(vm)) JSKeyObjectConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
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
    JSKeyObjectConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callKeyObject, constructKeyObject)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);
};

} // namespace Bun
