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

#include "Blob.h"
#include "DetachedRTCDataChannel.h"
#include "ExceptionOr.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/Forward.h>
#include <wtf/Function.h>
#include <wtf/Gigacage.h>
#include <wtf/text/WTFString.h>

typedef const struct OpaqueJSContext* JSContextRef;
typedef const struct OpaqueJSValue* JSValueRef;

#if ENABLE(WEBASSEMBLY)
namespace JSC {
namespace Wasm {
class Module;
class MemoryHandle;
}
}
#endif

namespace WebCore {

#if ENABLE(OFFSCREEN_CANVAS_IN_WORKERS)
class DetachedOffscreenCanvas;
#endif
class IDBValue;
class MessagePort;
class ImageBitmapBacking;
class FragmentedSharedBuffer;
enum class SerializationReturnCode;

enum class SerializationErrorMode { NonThrowing,
    Throwing };
enum class SerializationContext { Default,
    WorkerPostMessage,
    WindowPostMessage };

using ArrayBufferContentsArray = Vector<JSC::ArrayBufferContents>;
#if ENABLE(WEBASSEMBLY)
using WasmModuleArray = Vector<RefPtr<JSC::Wasm::Module>>;
using WasmMemoryHandleArray = Vector<RefPtr<JSC::Wasm::MemoryHandle>>;
#endif

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(SerializedScriptValue);
class SerializedScriptValue : public ThreadSafeRefCounted<SerializedScriptValue> {
    WTF_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(SerializedScriptValue);

public:
    WEBCORE_EXPORT static ExceptionOr<Ref<SerializedScriptValue>> create(JSC::JSGlobalObject&, JSC::JSValue, Vector<JSC::Strong<JSC::JSObject>>&& transfer, Vector<RefPtr<MessagePort>>&, SerializationContext = SerializationContext::Default);
    WEBCORE_EXPORT static RefPtr<SerializedScriptValue> create(JSC::JSGlobalObject&, JSC::JSValue, SerializationErrorMode = SerializationErrorMode::Throwing, SerializationContext = SerializationContext::Default);

    WEBCORE_EXPORT static RefPtr<SerializedScriptValue> create(StringView);

    static Ref<SerializedScriptValue> nullValue();

    WEBCORE_EXPORT JSC::JSValue deserialize(JSC::JSGlobalObject&, JSC::JSGlobalObject*, SerializationErrorMode = SerializationErrorMode::Throwing);
    WEBCORE_EXPORT JSC::JSValue deserialize(JSC::JSGlobalObject&, JSC::JSGlobalObject*, const Vector<RefPtr<MessagePort>>&, SerializationErrorMode = SerializationErrorMode::Throwing);
    JSC::JSValue deserialize(JSC::JSGlobalObject&, JSC::JSGlobalObject*, const Vector<RefPtr<MessagePort>>&, const Vector<String>& blobURLs, const Vector<String>& blobFilePaths, SerializationErrorMode = SerializationErrorMode::Throwing);

    static uint32_t wireFormatVersion();

    String toString() const;

    // API implementation helpers. These don't expose special behavior for ArrayBuffers or MessagePorts.
    WEBCORE_EXPORT static RefPtr<SerializedScriptValue> create(JSContextRef, JSValueRef, JSValueRef* exception);
    WEBCORE_EXPORT JSValueRef deserialize(JSContextRef, JSValueRef* exception);

    // bool hasBlobURLs() const { return !m_blobHandles.isEmpty(); }

    // Vector<String> blobURLs() const;
    // const Vector<BlobURLHandle>& blobHandles() const { return m_blobHandles; }
    // void writeBlobsToDiskForIndexedDB(CompletionHandler<void(IDBValue&&)>&&);
    // IDBValue writeBlobsToDiskForIndexedDBSynchronously();
    static Ref<SerializedScriptValue> createFromWireBytes(Vector<uint8_t>&& data)
    {
        return adoptRef(*new SerializedScriptValue(WTFMove(data)));
    }
    const Vector<uint8_t>& wireBytes() const { return m_data; }

    template<class Encoder> void encode(Encoder&) const;
    template<class Decoder> static RefPtr<SerializedScriptValue> decode(Decoder&);

    size_t memoryCost() const { return m_memoryCost; }

    WEBCORE_EXPORT ~SerializedScriptValue();

private:
    static ExceptionOr<Ref<SerializedScriptValue>> create(JSC::JSGlobalObject&, JSC::JSValue, Vector<JSC::Strong<JSC::JSObject>>&& transfer, Vector<RefPtr<MessagePort>>&, SerializationErrorMode, SerializationContext);
    WEBCORE_EXPORT SerializedScriptValue(
        Vector<unsigned char>&&, std::unique_ptr<ArrayBufferContentsArray>&& = nullptr
#if ENABLE(WEB_RTC)
        ,
        Vector<std::unique_ptr<DetachedRTCDataChannel>>&& = {}
#endif
    );

    SerializedScriptValue(
        Vector<unsigned char>&&, /*const Vector<BlobURLHandle>& blobHandles,*/ std::unique_ptr<ArrayBufferContentsArray>, std::unique_ptr<ArrayBufferContentsArray> sharedBuffers /*,Vector<std::optional<ImageBitmapBacking>>&& backingStores*/
#if ENABLE(OFFSCREEN_CANVAS_IN_WORKERS)
        ,
        Vector<std::unique_ptr<DetachedOffscreenCanvas>>&& = {}
#endif
#if ENABLE(WEB_RTC)
        ,
        Vector<std::unique_ptr<DetachedRTCDataChannel>>&& = {}
#endif
#if ENABLE(WEBASSEMBLY)
        ,
        std::unique_ptr<WasmModuleArray> = nullptr, std::unique_ptr<WasmMemoryHandleArray> = nullptr
#endif
    );

    size_t computeMemoryCost() const;

    Vector<unsigned char> m_data;
    std::unique_ptr<ArrayBufferContentsArray> m_arrayBufferContentsArray;
    std::unique_ptr<ArrayBufferContentsArray> m_sharedBufferContentsArray;
    // Vector<std::optional<ImageBitmapBacking>> m_backingStores;
#if ENABLE(OFFSCREEN_CANVAS_IN_WORKERS)
    Vector<std::unique_ptr<DetachedOffscreenCanvas>> m_detachedOffscreenCanvases;
#endif
#if ENABLE(WEB_RTC)
    Vector<std::unique_ptr<DetachedRTCDataChannel>> m_detachedRTCDataChannels;
#endif
#if ENABLE(WEBASSEMBLY)
    std::unique_ptr<WasmModuleArray> m_wasmModulesArray;
    std::unique_ptr<WasmMemoryHandleArray> m_wasmMemoryHandlesArray;
#endif
    // Vector<BlobURLHandle> m_blobHandles;
    size_t m_memoryCost { 0 };
};

template<class Encoder>
void SerializedScriptValue::encode(Encoder& encoder) const
{
    encoder << m_data;

    auto hasArray = m_arrayBufferContentsArray && m_arrayBufferContentsArray->size();
    encoder << hasArray;

    if (hasArray) {
        encoder << static_cast<uint64_t>(m_arrayBufferContentsArray->size());
        for (const auto& arrayBufferContents : *m_arrayBufferContentsArray) {
            encoder << static_cast<uint64_t>(arrayBufferContents.sizeInBytes());
            encoder.encodeFixedLengthData(static_cast<const uint8_t*>(arrayBufferContents.data()), arrayBufferContents.sizeInBytes(), 1);
        }
    }

#if ENABLE(WEB_RTC)
    encoder << static_cast<uint64_t>(m_detachedRTCDataChannels.size());
    for (const auto& channel : m_detachedRTCDataChannels)
        encoder << *channel;
#endif
}

template<class Decoder>
RefPtr<SerializedScriptValue> SerializedScriptValue::decode(Decoder& decoder)
{
    Vector<uint8_t> data;
    if (!decoder.decode(data))
        return nullptr;

    bool hasArray;
    if (!decoder.decode(hasArray))
        return nullptr;

    std::unique_ptr<ArrayBufferContentsArray> arrayBufferContentsArray;
    if (hasArray) {
        uint64_t arrayLength;
        if (!decoder.decode(arrayLength))
            return nullptr;
        ASSERT(arrayLength);

        arrayBufferContentsArray = makeUnique<ArrayBufferContentsArray>();
        while (arrayLength--) {
            uint64_t bufferSize;
            if (!decoder.decode(bufferSize))
                return nullptr;
            CheckedSize checkedBufferSize = bufferSize;
            if (checkedBufferSize.hasOverflowed())
                return nullptr;
            if (!decoder.template bufferIsLargeEnoughToContain<uint8_t>(bufferSize))
                return nullptr;

            auto buffer = Gigacage::tryMalloc(Gigacage::Primitive, bufferSize);
            if (!buffer)
                return nullptr;
            if (!decoder.decodeFixedLengthData(static_cast<uint8_t*>(buffer), bufferSize, 1)) {
                Gigacage::free(Gigacage::Primitive, buffer);
                return nullptr;
            }
            arrayBufferContentsArray->append({ buffer, checkedBufferSize, ArrayBuffer::primitiveGigacageDestructor() });
        }
    }

#if ENABLE(WEB_RTC)
    uint64_t detachedRTCDataChannelsSize;
    if (!decoder.decode(detachedRTCDataChannelsSize))
        return nullptr;

    Vector<std::unique_ptr<DetachedRTCDataChannel>> detachedRTCDataChannels;
    while (detachedRTCDataChannelsSize--) {
        auto detachedRTCDataChannel = DetachedRTCDataChannel::decode(decoder);
        if (!detachedRTCDataChannel)
            return nullptr;
        detachedRTCDataChannels.append(WTFMove(detachedRTCDataChannel));
    }
#endif

    return adoptRef(*new SerializedScriptValue(WTFMove(data), WTFMove(arrayBufferContentsArray)
#if ENABLE(WEB_RTC)
                                                                  ,
        WTFMove(detachedRTCDataChannels)
#endif
            ));
}

}
