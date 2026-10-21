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

template<CopiedBuffers Copied, typename Buffer>
static ALWAYS_INLINE bool isCopied(Buffer* buffer)
{
    if constexpr (Copied == CopiedBuffers::Shared)
        return buffer->isShared();
    else
        return buffer->canBeWrittenConcurrently();
}

template<CopiedBuffers Copied>
static ALWAYS_INLINE std::span<const uint8_t> bytesAndIsCopied(JSValue value, bool& copied)
{
    std::span<const uint8_t> bytes;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
        bytes = view->span();
        copied = isCopied<Copied>(view);
    } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
        bytes = buffer->impl()->span();
        copied = isCopied<Copied>(buffer->impl());
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
    bool copied = false;
    return bytesAndIsCopied<CopiedBuffers::Shared>(value, copied);
}

template<CopiedBuffers Copied>
std::span<const uint8_t> bytesOfBlobOrBuffer(JSValue value, bool& copied)
{
    return bytesAndIsCopied<Copied>(value, copied);
}
template std::span<const uint8_t> bytesOfBlobOrBuffer<CopiedBuffers::Shared>(JSValue, bool&);
template std::span<const uint8_t> bytesOfBlobOrBuffer<CopiedBuffers::SharedAndMapped>(JSValue, bool&);

template<CopiedBuffers Copied>
bool isCopiedBuffer(JSValue value)
{
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value))
        return isCopied<Copied>(view);
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value))
        return isCopied<Copied>(buffer->impl());
    return false;
}
template bool isCopiedBuffer<CopiedBuffers::Shared>(JSValue);
template bool isCopiedBuffer<CopiedBuffers::SharedAndMapped>(JSValue);

std::span<const uint8_t> copyBytes(JSGlobalObject& globalObject, std::span<const uint8_t> bytes, MallocSpan<uint8_t>& copy)
{
    if (bytes.empty())
        return bytes;
    // Not a Vector, which holds less than a buffer can.
    copy = MallocSpan<uint8_t>::tryMalloc(bytes.size());
    if (!copy) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
        throwOutOfMemoryError(&globalObject, scope);
        return bytes;
    }
    memcpySpan(copy.mutableSpan(), bytes);
    return copy.span();
}

}

extern "C" Bun::Bindgen::ExternBytes Bun__Bindgen__bytesOfBlobOrBuffer(JSC::EncodedJSValue value)
{
    auto bytes = Bun::Bindgen::bytesOfBlobOrBuffer(JSC::JSValue::decode(value));
    return { bytes.data(), bytes.size() };
}

extern "C" Bun::Bindgen::ExternBytes Bun__Bindgen__bytesOfBlobOrBufferAndCanBeWrittenConcurrently(JSC::EncodedJSValue value, bool* canBeWrittenConcurrently)
{
    *canBeWrittenConcurrently = Bun::Bindgen::isCopiedBuffer<Bun::Bindgen::CopiedBuffers::SharedAndMapped>(JSC::JSValue::decode(value));
    return Bun__Bindgen__bytesOfBlobOrBuffer(value);
}
