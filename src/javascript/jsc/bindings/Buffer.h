#pragma once
// ----- THIS IS NOT WEBCORE ----
// It reuses the namespace.
// ----- THIS IS NOT WEBCORE ----

// Node.js buffer

#include "root.h"

#include "BufferEncodingType.h"
#include "JavaScriptCore/GenericTypedArrayView.h"

namespace WebCore {

class Buffer final : public RefCounted<Buffer> {
public:
    using Adaptor = JSC::JSUint8Array::Adaptor;
    ~Buffer();

    static int32_t write(WTF::StringView view, size_t offset, size_t length, BufferEncodingType encodingType);

    static Ref<Buffer> create(JSC::JSGlobalObject* globalObject, RefPtr<ArrayBuffer>&&, size_t byteOffset, size_t length);
    static Ref<Buffer> create(JSC::JSGlobalObject* globalObject, RefPtr<ArrayBuffer>&&);

    static Ref<Buffer> createEmpty(JSC::JSGlobalObject* globalObject);
    static Ref<Buffer> create(JSC::JSGlobalObject* globalObject, UChar* ptr, size_t len, BufferEncodingType encoding);
    static Ref<Buffer> create(JSC::JSGlobalObject* globalObject, LChar* ptr, size_t len, BufferEncodingType encoding);

    static Ref<Buffer> create(JSC::JSGlobalObject* globalObject, WTF::StringView&, BufferEncodingType encoding);
    static Ref<Buffer> create(JSC::JSGlobalObject* globalObject, WTF::String&, BufferEncodingType encoding);

    Buffer(JSC::JSGlobalObject* globalObject, RefPtr<ArrayBuffer>&& arrayBuffer, size_t byteOffset,
        size_t length)
        : m_arrayBuffer(WTFMove(arrayBuffer))

    {
    }

    RefPtr<JSC::ArrayBuffer> m_arrayBuffer;
};

}