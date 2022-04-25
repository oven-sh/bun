// ----- THIS IS NOT WEBCORE ----
// It reuses the namespace.
// ----- THIS IS NOT WEBCORE ----

// Node.js buffer

#include "root.h"

#include "Buffer.h"
#include "JavaScriptCore/JSArrayBufferViewInlines.h"

namespace WebCore {

Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, RefPtr<ArrayBuffer>&& arrayBuffer, size_t byteOffset, size_t length)
{
    return adoptRef(*new Buffer(globalObject, WTFMove(arrayBuffer), byteOffset, length));
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, RefPtr<ArrayBuffer>&& arrayBuffer)
{
    return create(globalObject, WTFMove(arrayBuffer), 0, arrayBuffer->byteLength());
}

int32_t static write(WTF::StringView view, size_t offset, size_t length, BufferEncodingType encodingType)
{
}

Buffer::~Buffer()
{
    m_arrayBuffer->deref();
}

Ref<Buffer> Buffer::createEmpty(JSC::JSGlobalObject* globalObject)
{
    return adoptRef(*new Buffer(globalObject, nullptr, 0, 0));
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, UChar* ptr, size_t len, BufferEncodingType encoding)
{
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, LChar* ptr, size_t len, BufferEncodingType encoding)
{
}

Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, WTF::StringView& str, BufferEncodingType encoding)
{
    if (str.is8Bit()) {
    }
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, WTF::String& str, BufferEncodingType encoding)
{
}

}