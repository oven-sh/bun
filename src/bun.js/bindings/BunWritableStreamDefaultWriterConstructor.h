#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

class JSWritableStreamDefaultWriterPrototype;

class JSWritableStreamDefaultWriterConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSWritableStreamDefaultWriterConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSWritableStreamDefaultWriterPrototype* prototype);

    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultWriterConstructor(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSWritableStreamDefaultWriterPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
};

} // namespace Bun
