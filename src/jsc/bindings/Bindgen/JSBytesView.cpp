#include "root.h"
#include "Bindgen/JSBytesView.h"
#include "Bindgen/ExternTraits.h"
#include "ErrorCode.h"
#include "blob.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>

namespace Bun::Bindgen {
using namespace JSC;

bool checkInMemoryBlob(JSGlobalObject& globalObject, JSValue value)
{
    if (!WebCore::mayHoldBlob(value))
        return false;
    const uint8_t* data = nullptr;
    size_t length = 0;
    auto bytes = WebCore::Blob__sharedView(JSValue::encode(value), &data, &length);
    if (bytes == WebCore::BlobBytes::NotInMemory) {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        Bun::throwError(&globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "File blob cannot be used here"_s);
        return false;
    }
    return bytes == WebCore::BlobBytes::InMemory;
}

static ALWAYS_INLINE std::span<const uint8_t> bytesAndIsShared(JSValue value, bool& isShared)
{
    std::span<const uint8_t> bytes;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
        bytes = view->span();
        isShared = view->isShared();
    } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
        bytes = buffer->impl()->span();
        isShared = buffer->impl()->isShared();
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
    return bytesAndIsShared(value, isShared);
}

std::span<const uint8_t> bytesOfBlobOrBuffer(JSValue value, bool& isShared)
{
    return bytesAndIsShared(value, isShared);
}

bool isSharedBuffer(JSValue value)
{
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value))
        return view->isShared();
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value))
        return buffer->impl()->isShared();
    return false;
}

bool copyBytes(JSGlobalObject& globalObject, std::span<const uint8_t>& bytes, BytesCopy& copy)
{
    if (bytes.empty())
        return true;
    // Not a Vector, which holds less than a buffer can.
    copy = MallocSpan<uint8_t>::tryMalloc(bytes.size());
    if (!*copy) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        throwOutOfMemoryError(&globalObject, scope);
        return false;
    }
    memcpySpan(copy->mutableSpan(), bytes);
    bytes = copy->span();
    return true;
}

}

extern "C" Bun::Bindgen::ExternBytes Bun__Bindgen__bytesOfBlobOrBuffer(JSC::EncodedJSValue value)
{
    auto bytes = Bun::Bindgen::bytesOfBlobOrBuffer(JSC::JSValue::decode(value));
    return { bytes.data(), bytes.size() };
}

extern "C" Bun::Bindgen::ExternBytes Bun__Bindgen__bytesOfBlobOrBufferAndIsShared(JSC::EncodedJSValue value, bool* isShared)
{
    *isShared = Bun::Bindgen::isSharedBuffer(JSC::JSValue::decode(value));
    return Bun__Bindgen__bytesOfBlobOrBuffer(value);
}
