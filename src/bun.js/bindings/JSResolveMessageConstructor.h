#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(callResolveMessage);
JSC_DECLARE_HOST_FUNCTION(constructResolveMessage);

class JSResolveMessageConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSResolveMessageConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSResolveMessageConstructor* constructor = new (NotNull, JSC::allocateCell<JSResolveMessageConstructor>(vm)) JSResolveMessageConstructor(vm, structure);
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
    JSResolveMessageConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callResolveMessage, constructResolveMessage)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "ResolveMessage"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

} // namespace Bun
