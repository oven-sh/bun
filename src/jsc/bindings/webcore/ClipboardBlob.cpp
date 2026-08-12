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
extern "C" void Blob__implClearFile(BlobImpl*);
extern "C" void Blob__implSetContentType(BlobImpl*, const uint8_t* mime, size_t length);
extern "C" void Blob__implReadBytes(BlobImpl*, JSC::JSGlobalObject*, void* ctx, void (*callback)(void* ctx, const uint8_t* ptr, size_t length, const uint8_t* error, size_t errorLength));
extern "C" void* Blob__fromBytesWithNormalizedType(JSC::JSGlobalObject*, const uint8_t* ptr, size_t len, const uint8_t* mime, size_t mimeLength, bool normalize);
extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject*, void*);

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

namespace {
struct ClipboardBlobReadContext {
    ClipboardBlobReadCompletion completion;
};
}

static void clipboardBlobReadComplete(void* opaque, const uint8_t* bytes, size_t length, const uint8_t* error, size_t errorLength)
{
    std::unique_ptr<ClipboardBlobReadContext> context { static_cast<ClipboardBlobReadContext*>(opaque) };
    String failureMessage;
    if (error)
        failureMessage = String::fromUTF8ReplacingInvalidSequences({ error, errorLength });
    context->completion({ bytes, length }, failureMessage);
}

void clipboardBlobReadAsync(JSC::JSGlobalObject& globalObject, Blob& blob, ClipboardBlobReadCompletion&& completion)
{
    auto* impl = blob.impl();
    if (!impl) {
        completion({}, "The Blob is detached."_s);
        return;
    }
    Blob__implReadBytes(impl, &globalObject, new ClipboardBlobReadContext { WTF::move(completion) }, clipboardBlobReadComplete);
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
    return Blob::createAdopted(impl).releaseNonNull();
}

JSC::JSValue clipboardBlobToJS(JSC::JSGlobalObject* globalObject, Blob& blob, const String& type)
{
    auto* impl = blob.impl();
    if (!impl)
        return JSC::jsNull();
    // A dupe shares the backing store (no byte copy); clear its File identity
    // and report the type that was asked for.
    auto* dupe = static_cast<BlobImpl*>(Blob__dupe(impl));
    Blob__implClearFile(dupe);
    if (!clipboardBlobTypeMatches(clipboardBlobContentType(blob), type)) {
        Bun::UTF8View requested(type);
        auto requestedBytes = requested.bytes();
        Blob__implSetContentType(dupe, requestedBytes.data(), requestedBytes.size());
    }
    return JSC::JSValue::decode(Blob__create(globalObject, dupe));
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
