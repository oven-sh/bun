// ----- THIS IS NOT WEBCORE ----
// It reuses the namespace.
// ----- THIS IS NOT WEBCORE ----

// Node.js buffer

#include "root.h"

#include "Buffer.h"
#include <JavaScriptCore/Uint8Array.h>

namespace WebCore {

Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, JSC::JSUint8Array* array, size_t byteOffset, size_t length)
{
    return adoptRef(*new Buffer(globalObject, array, byteOffset, length));
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, JSC::JSUint8Array* array)
{
    return create(globalObject, array, 0, array->byteLength());
}

int32_t static write(WTF::StringView view, size_t offset, size_t length, BufferEncodingType encodingType)
{
    RELEASE_ASSERT_NOT_REACHED();
}

Buffer::~Buffer()
{
    RELEASE_ASSERT_NOT_REACHED();
}

Ref<Buffer> Buffer::createEmpty(JSC::JSGlobalObject* globalObject)
{
    return adoptRef(*new Buffer(globalObject, nullptr, 0, 0));
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, UChar* ptr, size_t len, BufferEncodingType encoding)
{
    RELEASE_ASSERT_NOT_REACHED();
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, LChar* ptr, size_t len, BufferEncodingType encoding)
{
    RELEASE_ASSERT_NOT_REACHED();
}

Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, WTF::StringView& str, BufferEncodingType encoding)
{
    RELEASE_ASSERT_NOT_REACHED();
}
Ref<Buffer> Buffer::create(JSC::JSGlobalObject* globalObject, WTF::String& str, BufferEncodingType encoding)
{
    RELEASE_ASSERT_NOT_REACHED();
}

}