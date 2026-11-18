
#include "root.h"

#include <JavaScriptCore/BunFFI.h>
#include <JavaScriptCore/FFIConversions.h>
#include <JavaScriptCore/FFISignature.h>
#include <JavaScriptCore/FFIType.h>
#include <JavaScriptCore/FFIContext.h>
#include <JavaScriptCore/JSFFICallback.h>
#include <JavaScriptCore/JSFFIFunction.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSObject.h>
#include <wtf/text/MakeString.h>

#include "ZigGlobalObject.h"
#include "headers-handwritten.h"

#if defined(BUN_DISABLE_FFI)

static JSC::EncodedJSValue throwBuiltWithoutFFI(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSC::throwTypeError(globalObject, scope, "bun:ffi: this build of Bun does not call native functions"_s);
    return {};
}

extern "C" JSC::EncodedJSValue Bun__CreateJSCFFIFunction(Zig::GlobalObject* globalObject, const EncodedSlice*, const uint8_t*, unsigned, uint8_t, void*, JSC::EncodedJSValue)
{
    return throwBuiltWithoutFFI(globalObject);
}

extern "C" JSC::EncodedJSValue Bun__CreateJSCFFICallback(Zig::GlobalObject* globalObject, JSC::EncodedJSValue, const uint8_t*, unsigned, uint8_t, bool)
{
    return throwBuiltWithoutFFI(globalObject);
}

extern "C" void Bun__JSCFFICallbackClose(JSC::EncodedJSValue)
{
}

extern "C" uint64_t Bun__FFI__jsValueToSlotSlow(JSC::JSGlobalObject* globalObject, int32_t, bool* threw, JSC::EncodedJSValue)
{
    throwBuiltWithoutFFI(globalObject);
    *threw = true;
    return 0;
}

#else

static_assert(static_cast<uint8_t>(JSC::FFI::Type::Char) == 0, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Int64) == 7, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Uint64) == 8, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Pointer) == 12, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::CString) == 14, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Int64Fast) == 15, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Uint64Fast) == 16, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Function) == 17, "FFI::Type tag drift");
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

    JSC::FFI::Signature signature { { argTypes, argCount }, returnType };
    if (!signature.isSupported()) {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: unsupported signature"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    JSC::JSObject* owner = JSC::JSValue::decode(ownerValue).getObject();

    WTF::String name = symbolName ? Zig::toStringCopy(*symbolName) : WTF::String();
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::FFI::createFunction(globalObject, signature, target, name, owner)));
}

static void Bun__jscFFIThreadsafeDispatch(JSC::FFI::ThreadsafeInvocation* invocation, void* embedderContext)
{
    static_assert(sizeof(WebCore::ScriptExecutionContextIdentifier) <= sizeof(void*));
    auto contextId = static_cast<WebCore::ScriptExecutionContextIdentifier>(reinterpret_cast<uintptr_t>(embedderContext));
    WebCore::ScriptExecutionContext::postTaskTo(contextId, BunLoopKind::Regular, [invocation = std::unique_ptr<JSC::FFI::ThreadsafeInvocation>(invocation)](WebCore::ScriptExecutionContext&) { invocation->run(); });
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

    JSC::JSObject* callable = JSC::JSValue::decode(callableValue).getObject();
    if (!callable || !callable->isCallable()) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: JSCallback requires a function"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    JSC::FFI::Signature signature { { argTypes, argCount }, returnType };
    if (!signature.isSupported()) {
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
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSFFICallback::create(globalObject, signature, callable, threadsafe ? Bun__jscFFIThreadsafeDispatch : nullptr, embedderContext)));
}

extern "C" void Bun__JSCFFICallbackClose(JSC::EncodedJSValue callbackValue)
{
    if (auto* callback = dynamicDowncast<JSC::JSFFICallback>(JSC::JSValue::decode(callbackValue)))
        callback->close();
}

// Implements JSVALUE_TO_SLOT_SLOW in src/runtime/ffi/FFI.h. Converts a cc() wrapper's arguments the way dlopen() does.
extern "C" uint64_t Bun__FFI__jsValueToSlotSlow(JSC::JSGlobalObject* globalObject, int32_t abiType, bool* threw, JSC::EncodedJSValue encodedValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto type = static_cast<JSC::FFI::Type>(abiType);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);

    // The wrapper already holds raw pointers into the buffers of earlier arguments, and JS could free those buffers.
    // slotFromJSValue only runs JS to get `ptr` from an object, so read it here without running a getter.
    bool isPointer = type == JSC::FFI::Type::Pointer || type == JSC::FFI::Type::CString || type == JSC::FFI::Type::Function;
    if (auto* object = value.getObject(); isPointer && object && !object->inherits<JSC::JSArrayBuffer>() && !object->inherits<JSC::JSFFICallback>()) {
        value = object->getDirect(vm, JSC::Identifier::fromString(vm, "ptr"_s));
        if (!value || !(value.isNumber() || value.isBigInt())) {
            JSC::throwTypeError(globalObject, scope, makeString("bun:ffi cannot convert argument to '"_s, JSC::FFI::name(type), '\''));
            *threw = true;
            return 0;
        }
    }

    uint64_t slot = JSC::FFI::slotFromJSValue(globalObject, type, value);
    if (scope.exception()) [[unlikely]] {
        *threw = true;
        return 0;
    }
    return slot;
}

#endif // defined(BUN_DISABLE_FFI)

extern "C" void Bun__FFI__throwIfDisabled(JSC::JSGlobalObject* globalObject)
{
#if defined(BUN_DISABLE_FFI)
    throwBuiltWithoutFFI(globalObject);
#else
    UNUSED_PARAM(globalObject);
#endif
}
