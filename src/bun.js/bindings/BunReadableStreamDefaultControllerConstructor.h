#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

class JSReadableStreamDefaultControllerConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSReadableStreamDefaultControllerConstructor* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSC::JSObject* prototype);

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

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);

private:
    JSReadableStreamDefaultControllerConstructor(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
};

} // namespace Bun
