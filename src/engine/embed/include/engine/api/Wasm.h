#pragma once

// The objects of WebAssembly.

#include "engine/api/Buffers.h"

namespace JSC {

// What a script passed, which the engine has read by now.
class WebAssemblyCompileOptions {
public:
    explicit WebAssemblyCompileOptions(JSValue value)
        : m_value(value)
    {
    }

    JSValue value() const { return m_value; }

private:
    JSValue m_value;
};

namespace Wasm {

enum class CompilerMode : bool { Validation,
    FullCompile };

// Any thread may have one.
class Module {
public:
    void ref() const { Engine::wasm_module_retain(this); }
    void deref() const { Engine::wasm_module_release(this); }
};

// The same.
class SharedMemory {
public:
    void ref() const { Engine::wasm_shared_memory_retain(this); }
    void deref() const { Engine::wasm_shared_memory_release(this); }

    size_t size() const { return Engine::wasm_shared_memory_byte_length(*this); }
};

// Settles the promise with the module, or with the module and an instance of it.
class StreamingCompiler {
public:
    static Ref<StreamingCompiler> create(CompilerMode mode, JSGlobalObject* globalObject, JSPromise* promise, JSObject* imports, std::optional<WebAssemblyCompileOptions>&& options) { return Engine::wasm_streaming_compiler_create(globalObject, promise, mode == CompilerMode::FullCompile, imports, options ? options->value() : jsUndefined()); }

    void ref() const { Engine::wasm_streaming_compiler_retain(this); }
    void deref() const { Engine::wasm_streaming_compiler_release(this); }

    void addBytes(std::span<const uint8_t> bytes) { Engine::wasm_streaming_compiler_add_bytes(*this, bytes); }
    void finalize(JSGlobalObject* globalObject) { Engine::wasm_streaming_compiler_finish(*this, globalObject); }
    void fail(JSGlobalObject* globalObject, JSValue error) { Engine::wasm_streaming_compiler_fail(*this, globalObject, error); }
    void cancel() { Engine::wasm_streaming_compiler_cancel(*this); }
};

} // namespace Wasm

class JSWebAssemblyModule final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(WasmModule)

    static JSWebAssemblyModule* create(JSGlobalObject* globalObject, Wasm::Module& module) { return static_cast<JSWebAssemblyModule*>(Engine::wasm_module_object_create(globalObject, Ref { module })); }

    Ref<Wasm::Module> module() const { return Engine::wasm_module_object_module(this); }
};
ENGINE_CLASS_HAS_TYPE(JSWebAssemblyModule, WebAssemblyModuleType);

class JSWebAssemblyMemory final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(WasmMemory)

    static JSWebAssemblyMemory* create(JSGlobalObject* globalObject, Wasm::SharedMemory& memory) { return static_cast<JSWebAssemblyMemory*>(Engine::wasm_memory_object_create(globalObject, memory)); }
    // The memory, not shared, whose bytes the buffer has, if it is alive.
    static JSWebAssemblyMemory* ownerOf(VM& vm, const ArrayBuffer& buffer) { return static_cast<JSWebAssemblyMemory*>(Engine::wasm_memory_object_of_buffer(vm, buffer)); }

    void* basePointer() const { return Engine::wasm_memory_object_base(this); }
    size_t size() const { return Engine::wasm_memory_object_byte_length(this); }
    // Null unless it is shared.
    RefPtr<Wasm::SharedMemory> share() const { return Engine::wasm_memory_object_share(this); }
};
template<> struct JSCastingHelpers::InheritsTraits<JSWebAssemblyMemory> {
    static bool inherits(const JSCell* from) { return Engine::wasm_is_memory_object(from); }
};

inline JSObject* createJSWebAssemblyCompileError(JSGlobalObject* globalObject, VM&, const String& message) { return Engine::wasm_compile_error_create(globalObject, message); }

} // namespace JSC
