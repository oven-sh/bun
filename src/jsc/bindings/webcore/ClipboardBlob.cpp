#include "config.h"
#include "ClipboardBlob.h"

#include "BunString.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/StringView.h>

namespace WebCore {

// Implemented in src/runtime/webcore/Blob.rs. These take the impl directly,
// unlike blob.h's getters, which take the JS wrapper.
extern "C" void Blob__implGetSpan(BlobImpl*, const uint8_t** outPtr, size_t* outLength);
extern "C" bool Blob__implNeedsToReadFile(BlobImpl*);
extern "C" void Blob__implGetContentType(BlobImpl*, const uint8_t** outPtr, size_t* outLength);
extern "C" void* Blob__fromBytesWithNormalizedType(JSC::JSGlobalObject*, const uint8_t* ptr, size_t len, const uint8_t* mime, size_t mimeLength, bool normalize);

std::span<const uint8_t> clipboardBlobBytes(Blob& blob)
{
    auto* impl = blob.impl();
    if (!impl)
        return {};
    const uint8_t* data = nullptr;
    size_t size = 0;
    Blob__implGetSpan(impl, &data, &size);
    if (!data || !size)
        return {};
    return { data, size };
}

bool clipboardBlobNeedsToReadFile(Blob& blob)
{
    auto* impl = blob.impl();
    return impl && Blob__implNeedsToReadFile(impl);
}

String clipboardBlobContentType(Blob& blob)
{
    auto* impl = blob.impl();
    if (!impl)
        return {};
    const uint8_t* ptr = nullptr;
    size_t length = 0;
    Blob__implGetContentType(impl, &ptr, &length);
    if (!ptr || !length)
        return {};
    // Content types are ASCII; the bytes live as long as the impl.
    return String::fromUTF8({ ptr, length });
}

Ref<Blob> createClipboardBlob(JSC::JSGlobalObject* globalObject, std::span<const uint8_t> bytes, const String& type, MimeNormalization normalization)
{
    Bun::UTF8View mime(type);
    auto mimeBytes = mime.bytes();
    void* impl = Blob__fromBytesWithNormalizedType(globalObject, bytes.data(), bytes.size(), mimeBytes.data(), mimeBytes.size(), normalization == MimeNormalization::LikeBlobConstructor);
    RELEASE_ASSERT(impl);
    // Blob::create takes its own reference; drop the one the factory handed us.
    RefPtr blob = Blob::create(impl);
    Blob__deref(impl);
    RELEASE_ASSERT(blob);
    return blob.releaseNonNull();
}

bool clipboardBlobTypeMatches(const String& declared, const String& requested)
{
    if (declared == requested)
        return true;
    // Bun's Blob promotes text types to carry a charset parameter, so a Blob
    // asked for as "text/plain" may report "text/plain;charset=utf-8".
    return declared.length() > requested.length() && declared[requested.length()] == ';' && declared.startsWith(requested);
}

} // namespace WebCore
