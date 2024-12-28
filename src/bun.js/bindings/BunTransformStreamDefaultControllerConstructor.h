#pragma once

#include "root.h"

namespace Bun {

class JSTransformStreamDefaultControllerPrototype;

class JSTransformStreamDefaultControllerConstructor final : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    static JSTransformStreamDefaultControllerConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStreamDefaultControllerPrototype* prototype);

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
    JSTransformStreamDefaultControllerConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSTransformStreamDefaultControllerPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
};

} // namespace Bun
