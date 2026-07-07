#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramConstructorCall);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramConstructorConstruct);

class JSNodePerformanceHooksHistogramConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodePerformanceHooksHistogramConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSNodePerformanceHooksHistogramConstructor* constructor = new (NotNull, JSC::allocateCell<JSNodePerformanceHooksHistogramConstructor>(vm)) JSNodePerformanceHooksHistogramConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSNodePerformanceHooksHistogramConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, jsNodePerformanceHooksHistogramConstructorCall, jsNodePerformanceHooksHistogramConstructorConstruct)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);
};

} // namespace Bun
