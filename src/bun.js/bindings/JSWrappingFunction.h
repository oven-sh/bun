#pragma once

namespace Zig {
class GlobalObject;
}

#include "root.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

namespace JSC {
class JSGlobalObject;
}

namespace Zig {

using NativeFunctionPtr = SYSV_ABI JSC::EncodedJSValue (*)(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

/**
 * Subclass of JSC::JSFunction that holds an additional single native JSFunction as property.
 * Can be used to wrap JS function calls with additional logic at native level.
 *
 * Used for example for bun test to implement support for `expect.extends()`.
 */
class JSWrappingFunction final : public JSC::JSFunction {
public:
    using Base = JSC::JSFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;
    static void destroy(JSCell* cell)
    {
        static_cast<JSWrappingFunction*>(cell)->JSWrappingFunction::~JSWrappingFunction();
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWrappingFunction, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForWrappingFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWrappingFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForWrappingFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForWrappingFunction = std::forward<decltype(space)>(space); });
    }

    DECLARE_EXPORT_INFO;
    static JSWrappingFunction* create(JSC::VM& vm, Zig::GlobalObject* globalObject, const BunString* symbolName, NativeFunctionPtr functionPointer, JSC::JSValue wrappedFn);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        ASSERT(globalObject);
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::JSFunctionType, StructureFlags), info());
    }

private:
    JSWrappingFunction(JSC::VM& vm, JSC::NativeExecutable* native, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, native, globalObject, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::NativeExecutable*, unsigned length, const String& name);

    DECLARE_VISIT_CHILDREN;

    JSC::WriteBarrier<JSC::JSFunction> m_wrappedFn;
};

}
