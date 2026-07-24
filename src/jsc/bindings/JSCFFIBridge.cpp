// bun:ffi -> JavaScriptCore-native FFI bridge.
//
// Bun's dlopen()/linkSymbols()/CFunction()/JSCallback historically JIT'd a C trampoline per
// symbol with TinyCC. When the WebKit fork provides the engine-native FFI machinery
// (JSC::JSFFIFunction / JSC::JSFFICallback under USE(BUN_JSC_ADDITIONS), described in
// WebKit's docs/ffi/SPEC.md), Bun creates those instead: no TinyCC state per symbol, no
// per-argument JS coercion wrappers, and DFG/FTL integration of the call sites. The Rust side
// (src/runtime/ffi/ffi_body.rs) decides when this path is taken -- signatures without
// napi_env/napi_value and non-threadsafe callbacks, unless the
// BUN_FEATURE_FLAG_DISABLE_JSC_FFI escape hatch is set.

#include "root.h"

#include <JavaScriptCore/BunFFI.h>
#include <JavaScriptCore/FFISignature.h>
#include <JavaScriptCore/FFIType.h>
#include <JavaScriptCore/JSFFICallback.h>
#include <JavaScriptCore/JSFFIFunction.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSObject.h>

#include "ZigGlobalObject.h"
#include "headers-handwritten.h"

// The engine's FFI::Type tags are wire-compatible with Bun's FFIType / abi_type.rs ABIType tags
// (both fixed at char=0 .. buffer=20); assert the shared endpoints so a drift is a build break
// rather than a runtime miscompile.
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Char) == 0, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Pointer) == 12, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::NapiValue) == 19, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Buffer) == 20, "FFI::Type tag drift");

// Creates a JSC-native FFI function for `target` with the given Bun ABIType tags. Returns the
// encoded JSFFIFunction, or an empty value with an exception pending on failure (invalid
// signature, executable-memory exhaustion). `argTypes` may be null when `argCount` is 0.
extern "C" JSC::EncodedJSValue Bun__CreateJSCFFIFunction(
    Zig::GlobalObject* globalObject,
    const ZigString* symbolName,
    const uint8_t* argTypes,
    unsigned argCount,
    uint8_t returnType,
    void* target)
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

    WTF::String name = symbolName ? Zig::toStringCopy(*symbolName) : WTF::String();
    JSC::JSFFIFunction* function = JSC::FFI::createFunction(globalObject, signature.releaseNonNull(), target, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (!function)
        RELEASE_AND_RETURN(scope, {});

    // `.ptr` (the resolved native pointer, for CFunction()/linkSymbols() and for passing a
    // function as a pointer argument) is an INTRINSIC property of JSFFIFunction served by the
    // engine. Deliberately NOT set here: a putDirect would transition the cell's Structure and cost
    // ~2.5x on every polymorphic (non-devirtualized) call site.

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(function));
}

// Creates a JSC-native (non-threadsafe) FFI callback wrapping `callable`. Returns the encoded
// JSFFICallback, whose read-only "ptr" property is the native entry point handed to C code.
extern "C" JSC::EncodedJSValue Bun__CreateJSCFFICallback(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue callableValue,
    const uint8_t* argTypes,
    unsigned argCount,
    uint8_t returnType)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

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

    JSC::JSFFICallback* callback = JSC::FFI::createCallback(globalObject, signature.releaseNonNull(), callable);
    RETURN_IF_EXCEPTION(scope, {});
    if (!callback)
        RELEASE_AND_RETURN(scope, {});

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(callback));
}

// Close a JSC-native callback created by Bun__CreateJSCFFICallback (idempotent).
extern "C" void Bun__JSCFFICallbackClose(JSC::EncodedJSValue callbackValue)
{
    if (auto* callback = dynamicDowncast<JSC::JSFFICallback>(JSC::JSValue::decode(callbackValue)))
        callback->close();
}
