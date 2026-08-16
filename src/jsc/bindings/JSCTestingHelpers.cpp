#include "root.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/JSString.h>
#include "ZigGlobalObject.h"

#if OS(WINDOWS)
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/ExecutableAllocator.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <windows.h>
#endif

namespace Bun {
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUTF16String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(false));
        }

        return JSValue::encode(jsBoolean(true));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsLatin1String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(true));
        }

        return JSValue::encode(jsBoolean(false));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

#if OS(WINDOWS)
JSC_DEFINE_HOST_FUNCTION(jsFunctionStartOfFixedExecutableMemoryPool,
    (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(JSC::startOfFixedExecutableMemoryPool<uintptr_t>()))));
}

// The labels JSC's LowLevelInterpreter.cpp puts around the offlineasm output
// (LLInt, vmEntryToJavaScript and friends). The .pdata record JSC emits for that
// code on Windows covers exactly this range.
extern "C" {
void jsc_llint_begin();
void jsc_llint_end();
}

// Returns { begin, end } of the offlineasm code range as bigints.
JSC_DEFINE_HOST_FUNCTION(jsFunctionLLIntCodeRange,
    (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue begin = JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(&jsc_llint_begin)));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue end = JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(&jsc_llint_end)));
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* range = JSC::constructEmptyObject(globalObject);
    range->putDirect(vm, JSC::Identifier::fromString(vm, "begin"_s), begin);
    range->putDirect(vm, JSC::Identifier::fromString(vm, "end"_s), end);
    return JSValue::encode(range);
}

// Walks the current stack with unwind tables only, the way the crash handler
// walks a fault's (capture_from_context in src/bun_core/debug.rs) and SEH
// dispatch and debuggers do, stopping at the first PC without a
// RUNTIME_FUNCTION. Returns the PCs as bigints, innermost first. Native rather
// than FFI so that the frames being read (JSC's host-call thunk, the JS
// callers, vmEntryToJavaScript, the C++ that entered JS) are still live.
JSC_DEFINE_HOST_FUNCTION(jsFunctionUnwindCurrentStack,
    (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    CONTEXT context;
    RtlCaptureContext(&context);

    MarkedArgumentBuffer pcs;
    for (unsigned i = 0; i < 64; i++) {
#if CPU(X86_64)
        DWORD64 pc = context.Rip;
        DWORD64 sp = context.Rsp;
#else
        DWORD64 pc = context.Pc;
        DWORD64 sp = context.Sp;
#endif
        if (!pc)
            break;
        JSValue value = JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(pc));
        RETURN_IF_EXCEPTION(scope, {});
        pcs.append(value);

        DWORD64 imageBase = 0;
        PRUNTIME_FUNCTION entry = RtlLookupFunctionEntry(pc, &imageBase, nullptr);
        if (!entry)
            break;
        PVOID handlerData = nullptr;
        DWORD64 establisherFrame = 0;
        RtlVirtualUnwind(UNW_FLAG_NHANDLER, imageBase, pc, entry, &context, &handlerData, &establisherFrame, nullptr);
#if CPU(X86_64)
        bool unchanged = context.Rip == pc && context.Rsp == sp;
#else
        bool unchanged = context.Pc == pc && context.Sp == sp;
#endif
        if (unchanged)
            break;
    }
    if (pcs.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), pcs)));
}
#endif

JSC::JSValue createJSCTestingHelpers(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSC::constructEmptyObject(globalObject);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isUTF16String"_s), 1,
        jsFunctionIsUTF16String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isLatin1String"_s), 1,
        jsFunctionIsLatin1String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

#if OS(WINDOWS)
    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "startOfFixedExecutableMemoryPool"_s), 0,
        jsFunctionStartOfFixedExecutableMemoryPool, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "llintCodeRange"_s), 0,
        jsFunctionLLIntCodeRange, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "unwindCurrentStack"_s), 0,
        jsFunctionUnwindCurrentStack, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
#endif

    return object;
}

} // namespace Bun
