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

using namespace JSC;

using FFIFunction = SYSV_ABI JSC::EncodedJSValue (*)(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

#if OS(WINDOWS)
using CFFIFunction = JSC::EncodedJSValue __attribute__((cdecl)) (*)(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
#else
using CFFIFunction = FFIFunction;
#endif

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
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForFFIFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForFFIFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForFFIFunction = std::forward<decltype(space)>(space); });
    }

    DECLARE_EXPORT_INFO;

    JS_EXPORT_PRIVATE static JSFFIFunction* create(VM&, Zig::GlobalObject*, unsigned length, const String& name, FFIFunction, Intrinsic = NoIntrinsic, NativeFunction nativeConstructor = callHostFunctionAsConstructor);
    JS_EXPORT_PRIVATE static JSFFIFunction* createForFFI(VM&, Zig::GlobalObject*, unsigned length, const String& name, CFFIFunction);

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSFunctionType, StructureFlags), info());
    }

    const CFFIFunction function() const { return m_function; }

#if OS(WINDOWS)

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES trampoline(JSGlobalObject* globalObject, CallFrame* callFrame);

#endif

    void* dataPtr;

private:
    JSFFIFunction(VM&, NativeExecutable*, JSGlobalObject*, Structure*, CFFIFunction&&);
    void finishCreation(VM&, NativeExecutable*, unsigned length, const String& name);
    DECLARE_VISIT_CHILDREN;

    CFFIFunction m_function;
};

} // namespace JSC

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunction(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong);
