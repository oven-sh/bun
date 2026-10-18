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

static std::span<const uint8_t> bytesOfBlobOrBuffer(JSValue value, bool& isShared)
{
    std::span<const uint8_t> bytes;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
        bytes = view->span();
        isShared = view->isShared();
    } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
        bytes = buffer->impl()->span();
        isShared = buffer->isShared();
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

std::span<const uint8_t> bytesOfBlobOrBuffer(JSValue value)
{
    bool isShared = false;
    return bytesOfBlobOrBuffer(value, isShared);
}

void JSBytesView::copyIfShared(JSGlobalObject& globalObject, JSValue argument, std::optional<MallocSpan<uint8_t>>& copy)
{
    if (!m_isBlobOrBuffer)
        return;
    bool isShared = false;
    auto bytes = bytesOfBlobOrBuffer(argument, isShared);
    if (!isShared)
        return;
    m_bytes = bytes;
    copyBytes(globalObject, copy);
}

void JSBytesView::readCopyingShared(JSGlobalObject& globalObject, JSValue argument, std::optional<MallocSpan<uint8_t>>& copy)
{
    if (!m_isBlobOrBuffer)
        return;
    bool isShared = false;
    m_bytes = bytesOfBlobOrBuffer(argument, isShared);
    if (isShared)
        copyBytes(globalObject, copy);
}

void JSBytesView::copyBytes(JSGlobalObject& globalObject, std::optional<MallocSpan<uint8_t>>& copy)
{
    if (m_bytes.empty())
        return;
    // Not a Vector, which holds less than a buffer can.
    copy = MallocSpan<uint8_t>::tryMalloc(m_bytes.size());
    if (!*copy) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        throwOutOfMemoryError(&globalObject, scope);
        return;
    }
    memcpySpan(copy->mutableSpan(), m_bytes);
    m_bytes = copy->span();
}

}

extern "C" Bun::Bindgen::ExternBytes Bun__Bindgen__bytesOfBlobOrBuffer(JSC::EncodedJSValue value)
{
    auto bytes = Bun::Bindgen::bytesOfBlobOrBuffer(JSC::JSValue::decode(value));
    return { bytes.data(), bytes.size() };
}
