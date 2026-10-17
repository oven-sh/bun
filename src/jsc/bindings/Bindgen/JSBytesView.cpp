#include "root.h"
#include "Bindgen/JSBytesView.h"
#include "Bindgen/ExternTraits.h"
#include "ErrorCode.h"
#include "ZigGeneratedClasses.h"
#include "blob.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>

namespace Bun::Bindgen {
using namespace JSC;

bool checkInMemoryBlob(JSGlobalObject& globalObject, JSValue value)
{
    if (!value.inherits<WebCore::JSBlob>())
        return false;
    const uint8_t* data = nullptr;
    size_t length = 0;
    if (!WebCore::Blob__sharedView(JSValue::encode(value), &data, &length)) {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        Bun::throwError(&globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "File blob cannot be used here"_s);
        return false;
    }
    return true;
}

std::span<const uint8_t> bytesOfBlobOrBuffer(JSValue value)
{
    std::span<const uint8_t> bytes;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
        bytes = view->span();
    } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
        bytes = buffer->impl()->span();
    } else {
        const uint8_t* data = nullptr;
        size_t length = 0;
        WebCore::Blob__sharedView(JSValue::encode(value), &data, &length);
        bytes = { data, length };
    }
    // A Rust slice has no null data.
    if (!bytes.data())
        return byteCast<uint8_t>(WTF::nonNullEmptyUTF8Span());
    return bytes;
}

static bool isSharedBuffer(JSValue value)
{
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value))
        return view->isShared();
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value))
        return buffer->isShared();
    return false;
}

void JSBytesView::copyIfShared(JSGlobalObject& globalObject, JSValue argument, MallocSpan<uint8_t>& copy)
{
    if (!m_isBlobOrBuffer || !isSharedBuffer(argument))
        return;
    m_bytes = bytesOfBlobOrBuffer(argument);
    if (m_bytes.empty())
        return;
    // Not a Vector, which holds less than a buffer can.
    copy = MallocSpan<uint8_t>::tryMalloc(m_bytes.size());
    if (!copy) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        throwOutOfMemoryError(&globalObject, scope);
        return;
    }
    memcpySpan(copy.mutableSpan(), m_bytes);
    m_bytes = copy.span();
}

}

extern "C" Bun::Bindgen::ExternBytes Bun__Bindgen__bytesOfBlobOrBuffer(JSC::EncodedJSValue value)
{
    auto bytes = Bun::Bindgen::bytesOfBlobOrBuffer(JSC::JSValue::decode(value));
    return { bytes.data(), bytes.size() };
}
