/*
 * Copyright (C) 2009, 2013, 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

#pragma once

#include "root.h"
#include "ExceptionOr.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/Strong.h>
#include <variant>
#include <wtf/FixedVector.h>
#include <wtf/Forward.h>
#include <wtf/Function.h>
#include <wtf/FastMalloc.h>
#include <wtf/text/WTFString.h>
#include "JavaScriptCore/WasmModule.h"

namespace JSC {
class JSObject;
class VM;
#if ENABLE(WEBASSEMBLY)
namespace Wasm {
class Module;
}
#endif
}

namespace WebCore {

// Shared value type for fast path cloning: primitives (JSValue) or strings.
using SimpleCloneableValue = std::variant<JSC::JSValue, WTF::String>;

class SimpleInMemoryPropertyTableEntry {
public:
    using Value = SimpleCloneableValue;

    WTF::String propertyName;
    Value value;
};

// A flat object whose property values are only primitives or strings (no nesting).
struct SimpleCloneableObject {
    WTF::FixedVector<SimpleInMemoryPropertyTableEntry> properties;
};

// Array element: primitive (JSValue), string, or a flat object.
using DenseArrayElement = std::variant<JSC::JSValue, WTF::String, SimpleCloneableObject>;

enum class FastPath : uint8_t {
    None,
    String,
    SimpleObject,
    SimpleArray,
    Int32Array,
    DoubleArray,
    DenseArray,
};

class MessagePort;
class CloneSerializer;
enum class SerializationReturnCode;

enum class SerializationErrorMode { NonThrowing,
    Throwing };
enum class SerializationContext { Default,
    WorkerPostMessage,
    WindowPostMessage };
enum class SerializationForStorage : bool { No,
    Yes };
enum class SerializationForCrossProcessTransfer : bool { No,
    Yes };

using ArrayBufferContentsArray = Vector<JSC::ArrayBufferContents>;
#if ENABLE(WEBASSEMBLY)
using WasmModuleArray = Vector<RefPtr<JSC::Wasm::Module>>;
using WasmMemoryHandleArray = Vector<RefPtr<JSC::SharedArrayBufferContents>>;
#endif

// worker_threads.markAsUncloneable() / markAsUntransferable(): create() rejects a tagged object.
void markAsUncloneable(JSC::VM&, JSC::JSObject&);
void markAsUntransferable(JSC::VM&, JSC::JSObject&);

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(SerializedScriptValue);
class SerializedScriptValue : public ThreadSafeRefCounted<SerializedScriptValue> {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(SerializedScriptValue, SerializedScriptValue);

public:
    static SYSV_ABI void writeBytesForBun(CloneSerializer*, const uint8_t*, uint32_t);
    static SYSV_ABI bool isTransferable(JSC::JSGlobalObject* globalObject, JSC::JSValue value);

    WEBCORE_EXPORT static ExceptionOr<Ref<SerializedScriptValue>> create(JSC::JSGlobalObject&, JSC::JSValue, Vector<JSC::Strong<JSC::JSObject>>&& transfer, Vector<RefPtr<MessagePort>>&, SerializationForStorage = SerializationForStorage::No, SerializationContext = SerializationContext::Default, SerializationForCrossProcessTransfer = SerializationForCrossProcessTransfer::No);

    WEBCORE_EXPORT static RefPtr<SerializedScriptValue> create(JSC::JSGlobalObject&, JSC::JSValue, SerializationForStorage = SerializationForStorage::No, SerializationErrorMode = SerializationErrorMode::Throwing, SerializationContext = SerializationContext::Default, SerializationForCrossProcessTransfer = SerializationForCrossProcessTransfer::No);

    static RefPtr<SerializedScriptValue> convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value) { return create(globalObject, value, SerializationForStorage::Yes); }

    // Fast path for postMessage with pure strings
    static Ref<SerializedScriptValue> createStringFastPath(const String& string);

    // Fast path for postMessage with simple objects
    static Ref<SerializedScriptValue> createObjectFastPath(WTF::FixedVector<SimpleInMemoryPropertyTableEntry>&& object);

    // Fast path for postMessage with dense arrays of primitives/strings
    static Ref<SerializedScriptValue> createArrayFastPath(WTF::FixedVector<SimpleCloneableValue>&& elements);

    // Fast path for postMessage with dense Int32/Double arrays (butterfly memcpy)
    static Ref<SerializedScriptValue> createInt32ArrayFastPath(Vector<uint8_t>&& butterflyData, uint32_t length);
    static Ref<SerializedScriptValue> createDoubleArrayFastPath(Vector<uint8_t>&& butterflyData, uint32_t length);

    // Fast path for postMessage with dense arrays containing simple objects
    static Ref<SerializedScriptValue> createDenseArrayFastPath(WTF::FixedVector<DenseArrayElement>&& elements);

    WEBCORE_EXPORT JSC::JSValue deserialize(JSC::JSGlobalObject&, JSC::JSGlobalObject*, SerializationErrorMode = SerializationErrorMode::Throwing, bool* didFail = nullptr);
    WEBCORE_EXPORT JSC::JSValue deserialize(JSC::JSGlobalObject&, JSC::JSGlobalObject*, const Vector<RefPtr<MessagePort>>&, SerializationErrorMode = SerializationErrorMode::Throwing, bool* didFail = nullptr);

    JSC::JSValue deserialize(JSC::JSGlobalObject&, JSC::JSGlobalObject*, const Vector<RefPtr<MessagePort>>&, const Vector<String>& blobURLs, const Vector<String>& blobFilePaths, SerializationErrorMode = SerializationErrorMode::Throwing, bool* didFail = nullptr);

    WEBCORE_EXPORT Ref<JSC::ArrayBuffer> toArrayBuffer();
    static JSC::JSValue fromArrayBuffer(JSC::JSGlobalObject&, JSC::JSGlobalObject*, JSC::ArrayBuffer* arrayBuffer, size_t byteOffset = 0, size_t maxByteLength = 0, SerializationErrorMode = SerializationErrorMode::Throwing, bool* didFail = nullptr);

    static Ref<SerializedScriptValue> createFromWireBytes(Vector<uint8_t>&& data)
    {
        return adoptRef(*new SerializedScriptValue(WTF::move(data)));
    }
    const Vector<uint8_t>& wireBytes() const { return m_data; }

    size_t memoryCost() const { return m_memoryCost; }

    WEBCORE_EXPORT ~SerializedScriptValue();

private:
    static ExceptionOr<Ref<SerializedScriptValue>> create(JSC::JSGlobalObject&, JSC::JSValue, Vector<JSC::Strong<JSC::JSObject>>&& transfer, Vector<RefPtr<MessagePort>>&, SerializationForStorage, SerializationErrorMode, SerializationContext, SerializationForCrossProcessTransfer);
    WEBCORE_EXPORT SerializedScriptValue(Vector<unsigned char>&&, std::unique_ptr<ArrayBufferContentsArray>&& = nullptr);

    SerializedScriptValue(Vector<unsigned char>&&, std::unique_ptr<ArrayBufferContentsArray>, std::unique_ptr<ArrayBufferContentsArray> sharedBuffers
#if ENABLE(WEBASSEMBLY)
        ,
        std::unique_ptr<WasmModuleArray> = nullptr, std::unique_ptr<WasmMemoryHandleArray> = nullptr
#endif
    );

    // Constructor for string fast path
    explicit SerializedScriptValue(const String& fastPathString);
    explicit SerializedScriptValue(WTF::FixedVector<SimpleInMemoryPropertyTableEntry>&& object);
    explicit SerializedScriptValue(WTF::FixedVector<SimpleCloneableValue>&& elements);
    // Constructor for Int32Array/DoubleArray butterfly memcpy fast path
    SerializedScriptValue(Vector<uint8_t>&& butterflyData, uint32_t length, FastPath fastPath);
    // Constructor for DenseArray fast path
    explicit SerializedScriptValue(WTF::FixedVector<DenseArrayElement>&& denseElements);

    size_t computeMemoryCost() const;

    Vector<unsigned char> m_data;
    std::unique_ptr<ArrayBufferContentsArray> m_arrayBufferContentsArray;
    std::unique_ptr<ArrayBufferContentsArray> m_sharedBufferContentsArray;
    // Raw `*mut BlockList` pointers whose refcount was bumped at serialize
    // time so they outlive the wire buffer; released in the destructor.
    Vector<void*> m_serializedBlockListRefs;
#if ENABLE(WEBASSEMBLY)
    std::unique_ptr<WasmModuleArray> m_wasmModulesArray;
    std::unique_ptr<WasmMemoryHandleArray> m_wasmMemoryHandlesArray;
#endif

    // Fast path for postMessage with pure strings - avoids serialization overhead
    String m_fastPathString;
    FastPath m_fastPath { FastPath::None };
    size_t m_memoryCost { 0 };

    FixedVector<SimpleInMemoryPropertyTableEntry> m_simpleInMemoryPropertyTable {};
    // m_simpleArrayElements and m_arrayButterflyData/m_arrayLength are used exclusively:
    // SimpleArray uses m_simpleArrayElements; Int32Array/DoubleArray use m_arrayButterflyData + m_arrayLength.
    FixedVector<SimpleCloneableValue> m_simpleArrayElements {};

    // Int32Array / DoubleArray fast path: raw butterfly data
    Vector<uint8_t> m_arrayButterflyData {};
    uint32_t m_arrayLength { 0 };

    // DenseArray fast path: array of primitives/strings/simple objects
    FixedVector<DenseArrayElement> m_denseArrayElements {};
};

}
