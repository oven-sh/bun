#pragma once

// Calls between scripts and native code whose signature is known only at run time.

#include "engine/api/GlobalObject.h"

namespace JSC {

namespace FFI {

enum class Type : uint8_t {
    Char = Engine::NativeType::Char,
    Int64 = Engine::NativeType::Int64,
    Uint64 = Engine::NativeType::Uint64,
    Pointer = Engine::NativeType::Pointer,
    CString = Engine::NativeType::CString,
    Int64Fast = Engine::NativeType::Int64Fast,
    Uint64Fast = Engine::NativeType::Uint64Fast,
    Function = Engine::NativeType::Function,
    JSValue = Engine::NativeType::Value,
    Buffer = Engine::NativeType::Buffer,
    BufferLength = Engine::NativeType::BufferLength,
};

inline ASCIILiteral name(Type type) { return ASCIILiteral::fromLiteralUnsafe(Engine::ffi_type_name(std::to_underlying(type))); }

// The numbers of the types, which need not be those of any.
struct Signature {
    bool isSupported() const { return Engine::ffi_is_signature_supported(arguments, result); }

    std::span<const uint8_t> arguments;
    uint8_t result;
};

// A call that native code has made, on any thread, and that is still to reach the script.
class ThreadsafeInvocation {
public:
    // Once, on the thread of the callback.
    void run() { Engine::ffi_invocation_run(*this); }
    void operator delete(ThreadsafeInvocation* invocation, std::destroying_delete_t) { Engine::ffi_invocation_destroy(invocation); }
};

// What native code gets for the value. A string cannot be converted, because nothing would free it.
inline uint64_t slotFromJSValue(JSGlobalObject* globalObject, Type type, JSC::JSValue value) { return Engine::ffi_value_to_slot(globalObject, std::to_underlying(type), value); }

// Keeps `owner` alive. The signature is supported.
inline JSFunction* createFunction(JSGlobalObject* globalObject, Signature signature, void* target, const String& name, JSObject* owner) { return Engine::ffi_function_create(globalObject, signature.arguments, signature.result, target, name, owner); }

} // namespace FFI

class JSFFICallback final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(FfiCallback)

    using Dispatch = void (*)(FFI::ThreadsafeInvocation*, void* context);

    // With `dispatch` any thread may call it. That comes to own each call. The signature is supported.
    static JSFFICallback* create(JSGlobalObject* globalObject, FFI::Signature signature, JSObject* callable, Dispatch dispatch, void* context) { return Engine::ffi_callback_create(globalObject, signature.arguments, signature.result, callable, dispatch, context); }

    void close() { Engine::ffi_callback_close(this, vm()); }
};

} // namespace JSC
