#include "config.h"
#include "ClipboardBlob.h"

#include "BunString.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/StringView.h>

namespace WebCore {

// Implemented in src/runtime/webcore/Blob.rs. These take the impl, unlike
// blob.h's getters, which take the JS wrapper.
extern "C" void Blob__implGetSpan(BlobImpl*, const uint8_t** outPtr, size_t* outLength);
extern "C" bool Blob__implNeedsToReadFile(BlobImpl*);
extern "C" void Blob__implGetContentType(BlobImpl*, const uint8_t** outPtr, size_t* outLength);
extern "C" void Blob__implClearFile(BlobImpl*);
extern "C" void Blob__implSetContentType(BlobImpl*, const uint8_t* mime, size_t length);
extern "C" void Blob__implReadBytes(BlobImpl*, JSC::JSGlobalObject*, void* ctx, void (*callback)(void* ctx, const uint8_t* ptr, size_t length, const uint8_t* error, size_t errorLength));
extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject*, void*);

std::span<const uint8_t> clipboardBlobBytes(Blob& blob)
{
    const uint8_t* data = nullptr;
    size_t size = 0;
    Blob__implGetSpan(blob.impl(), &data, &size);
    return { data, size };
}

bool clipboardBlobNeedsToReadFile(Blob& blob)
{
    return Blob__implNeedsToReadFile(blob.impl());
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
    Blob__implReadBytes(blob.impl(), &globalObject, new ClipboardBlobReadContext { WTF::move(completion) }, clipboardBlobReadComplete);
}

String clipboardBlobContentType(Blob& blob)
{
    const uint8_t* ptr = nullptr;
    size_t length = 0;
    Blob__implGetContentType(blob.impl(), &ptr, &length);
    return String::fromUTF8({ ptr, length });
}

JSC::JSValue clipboardBlobToJS(JSC::JSGlobalObject* globalObject, Blob& blob, const String& type)
{
    // The dupe shares the store; blob.h's toJS(Blob&) would mark it a File.
    auto* dupe = static_cast<BlobImpl*>(Blob__dupe(blob.impl()));
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
    // Bun's Blob adds a charset to text types.
    return declared.length() > requested.length() && declared[requested.length()] == ';' && declared.startsWith(requested);
}

} // namespace WebCore
