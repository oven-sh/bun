
#include "root.h"

#include <JavaScriptCore/BunFFI.h>
#include <JavaScriptCore/FFISignature.h>
#include <JavaScriptCore/FFIType.h>
#include <JavaScriptCore/FFIContext.h>
#include <JavaScriptCore/JSFFICallback.h>
#include <JavaScriptCore/JSFFIFunction.h>
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSObject.h>

#include "ZigGlobalObject.h"
#include "headers-handwritten.h"

static_assert(static_cast<uint8_t>(JSC::FFI::Type::Char) == 0, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Pointer) == 12, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::JSValue) == 19, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Buffer) == 20, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::BufferLength) == 21, "FFI::Type tag drift");

extern "C" JSC::EncodedJSValue Bun__CreateJSCFFIFunction(
    Zig::GlobalObject* globalObject,
    const EncodedSlice* symbolName,
    const uint8_t* argTypes,
    unsigned argCount,
    uint8_t returnType,
    void* target,
    JSC::EncodedJSValue ownerValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Vector<JSC::FFI::Type, 8> arguments;
    arguments.reserveInitialCapacity(argCount);
    for (unsigned i = 0; i < argCount; ++i)
        arguments.append(static_cast<JSC::FFI::Type>(argTypes[i]));

    RefPtr<JSC::FFI::Signature> signature = JSC::FFI::Signature::tryCreate(arguments.span(), static_cast<JSC::FFI::Type>(returnType));
    if (!signature) {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: unsupported signature"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    JSC::JSObject* owner = JSC::JSValue::decode(ownerValue).getObject();

    WTF::String name = symbolName ? Zig::toStringCopy(*symbolName) : WTF::String();
    JSC::JSFFIFunction* function = JSC::JSFFIFunction::create(vm, globalObject, globalObject->ffiFunctionStructure(), signature.releaseNonNull(), target, name, owner, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    if (!function)
        RELEASE_AND_RETURN(scope, {});

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(function));
}

static void Bun__jscFFIThreadsafeDispatch(JSC::FFI::ThreadsafeInvocation& invocation)
{
    static_assert(sizeof(WebCore::ScriptExecutionContextIdentifier) <= sizeof(void*));
    auto contextId = static_cast<WebCore::ScriptExecutionContextIdentifier>(reinterpret_cast<uintptr_t>(invocation.embedderContext()));
    WebCore::ScriptExecutionContext::postTaskTo(contextId, BunLoopKind::Regular, [protectedInvocation = Ref { invocation }](WebCore::ScriptExecutionContext&) mutable { JSC::FFI::runThreadsafeInvocation(protectedInvocation.get()); });
}

extern "C" JSC::EncodedJSValue Bun__CreateJSCFFICallback(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue callableValue,
    const uint8_t* argTypes,
    unsigned argCount,
    uint8_t returnType,
    bool threadsafe)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (threadsafe) {
        static std::once_flag registerDispatch;
        std::call_once(registerDispatch, [] {
            JSC::FFI::FFIContext::setThreadsafeDispatch(Bun__jscFFIThreadsafeDispatch);
        });
    }

    JSC::JSObject* callable = JSC::JSValue::decode(callableValue).getObject();
    if (!callable || !callable->isCallable()) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: JSCallback requires a function"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    Vector<JSC::FFI::Type, 8> arguments;
    arguments.reserveInitialCapacity(argCount);
    for (unsigned i = 0; i < argCount; ++i)
        arguments.append(static_cast<JSC::FFI::Type>(argTypes[i]));

    RefPtr<JSC::FFI::Signature> signature = JSC::FFI::Signature::tryCreate(arguments.span(), static_cast<JSC::FFI::Type>(returnType));
    if (!signature) {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: unsupported callback signature"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    void* embedderContext = nullptr;
    if (threadsafe) {
        auto* scriptExecutionContext = globalObject->scriptExecutionContext();
        if (!scriptExecutionContext) [[unlikely]] {
            JSC::throwTypeError(globalObject, scope, "bun:ffi: no script execution context for a threadsafe JSCallback"_s);
            RELEASE_AND_RETURN(scope, {});
        }
        embedderContext = reinterpret_cast<void*>(static_cast<uintptr_t>(scriptExecutionContext->identifier()));
    }
    JSC::JSFFICallback* callback = JSC::FFI::createCallback(globalObject, signature.releaseNonNull(), callable, threadsafe, embedderContext);
    RETURN_IF_EXCEPTION(scope, {});
    if (!callback)
        RELEASE_AND_RETURN(scope, {});

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(callback));
}

extern "C" void Bun__JSCFFICallbackClose(JSC::EncodedJSValue callbackValue)
{
    if (auto* callback = dynamicDowncast<JSC::JSFFICallback>(JSC::JSValue::decode(callbackValue)))
        callback->close();
}
