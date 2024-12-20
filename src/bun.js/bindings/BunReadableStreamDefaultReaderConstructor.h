#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

using namespace JSC;

class JSReadableStreamDefaultReaderPrototype;

class JSReadableStreamDefaultReaderConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSReadableStreamDefaultReaderConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStreamDefaultReaderPrototype* prototype);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

private:
    JSReadableStreamDefaultReaderConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSReadableStreamDefaultReaderPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
};

} // namespace Bun
