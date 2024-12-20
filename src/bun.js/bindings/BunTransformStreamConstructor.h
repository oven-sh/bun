#pragma once

#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

class JSTransformStreamPrototype;

class JSTransformStreamConstructor final : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    static JSTransformStreamConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSTransformStreamPrototype* prototype);

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

private:
    JSTransformStreamConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSTransformStreamPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
};
}
