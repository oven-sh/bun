#pragma once

namespace Zig {
class GlobalObject;
}

#include "root.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/VM.h"

#include "headers-handwritten.h"
#include "BunClientData.h"
#include "JavaScriptCore/CallFrame.h"

namespace JSC {
class JSGlobalObject;
}

namespace Zig {

using namespace JSC;

using FFIFunction = JSC::EncodedJSValue (*)(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

/**
 * Call a C function with low overhead, modeled after JSC::JSNativeStdFunction
 *
 * The C function is expected to know how to get the arguments out of the JSC::CallFrame and
 * return a JSC::EncodedJSValue. To do that, the argumentOffset is inlined at compile-time
 * into Bun's binary and again inlined into the C function.
 *
 * This is used by functions compiled with TinyCC
 *
 * It was about 20% faster than using the JavaScriptCore C API for functions with 1 argument
 *
 * There is no wrapper function. It does zero bounds checking on the arguments.
 * It does not check for exceptions. It does not check for return value.
 * It is the caller's responsibility to not buffer overflow the arguments
 * For all those reasons, this shouldn't be used directly.
 */
class JSFFIFunction final : public JSC::JSFunction {
public:
    using Base = JSFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;
    static void destroy(JSCell* cell)
    {
        static_cast<JSFFIFunction*>(cell)->JSFFIFunction::~JSFFIFunction();
    }

    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSFFIFunction, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForFFIFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForFFIFunction = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForFFIFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForFFIFunction = WTFMove(space); });
    }

    DECLARE_EXPORT_INFO;

    JS_EXPORT_PRIVATE static JSFFIFunction* create(VM&, Zig::GlobalObject*, unsigned length, const String& name, FFIFunction, Intrinsic = NoIntrinsic, NativeFunction nativeConstructor = callHostFunctionAsConstructor);

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSFunctionType, StructureFlags), info());
    }

    const FFIFunction function() { return m_function; }

    void* dataPtr;

private:
    JSFFIFunction(VM&, NativeExecutable*, JSGlobalObject*, Structure*, FFIFunction&&);
    void finishCreation(VM&, NativeExecutable*, unsigned length, const String& name);
    DECLARE_VISIT_CHILDREN;

    FFIFunction m_function;
};

} // namespace JSC

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunction(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong);
