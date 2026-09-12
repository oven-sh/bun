#include "config.h"
#include "ClipboardPlatform.h"

#include "BunString.h"
#include "ClipboardBlob.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/Vector.h>

namespace WebCore {

// Implemented in src/runtime/webcore/clipboard.rs. Each schedule call consumes
// the reference it is handed and copies any bytes it needs before returning, so
// nothing here has to outlive the call.
extern "C" void Bun__Clipboard__scheduleReadText(JSC::JSGlobalObject*, ClipboardRequest*);
extern "C" void Bun__Clipboard__scheduleRead(JSC::JSGlobalObject*, ClipboardRequest*);
extern "C" void Bun__Clipboard__scheduleWriteText(JSC::JSGlobalObject*, ClipboardRequest*, const uint8_t* text, size_t length);
extern "C" void Bun__Clipboard__scheduleWrite(JSC::JSGlobalObject*, ClipboardRequest*, const ClipboardRepresentation*, size_t count);
extern "C" bool Bun__Clipboard__supportsType(const uint8_t* mime, size_t length);
extern "C" bool Bun__Clipboard__writesSingleRepresentation();

void scheduleClipboardReadText(JSC::JSGlobalObject& globalObject, Ref<ClipboardRequest>&& request)
{
    Bun__Clipboard__scheduleReadText(&globalObject, &request.leakRef());
}

void scheduleClipboardRead(JSC::JSGlobalObject& globalObject, Ref<ClipboardRequest>&& request)
{
    Bun__Clipboard__scheduleRead(&globalObject, &request.leakRef());
}

void scheduleClipboardWriteText(JSC::JSGlobalObject& globalObject, Ref<ClipboardRequest>&& request, const String& text)
{
    Bun::UTF8View utf8(text);
    auto bytes = utf8.bytes();
    Bun__Clipboard__scheduleWriteText(&globalObject, &request.leakRef(), bytes.data(), bytes.size());
}

void scheduleClipboardWrite(JSC::JSGlobalObject& globalObject, Ref<ClipboardRequest>&& request, const ClipboardItemData& representations)
{
    // Flatten to the POD view the backend reads. The type views and the Blobs
    // both stay alive for the duration of the call, which is all the backend
    // needs — it snapshots the bytes into its job before returning.
    Vector<Bun::UTF8View> typeViews;
    typeViews.reserveInitialCapacity(representations.size());
    Vector<ClipboardRepresentation> flattened;
    flattened.reserveInitialCapacity(representations.size());

    for (auto& representation : representations) {
        typeViews.append(Bun::UTF8View(representation.key));
        auto typeBytes = typeViews.last().bytes();
        auto blobBytes = clipboardBlobBytes(representation.value.get());
        flattened.append(ClipboardRepresentation {
            typeBytes.data(), typeBytes.size(),
            blobBytes.data(), blobBytes.size() });
    }

    Bun__Clipboard__scheduleWrite(&globalObject, &request.leakRef(), flattened.span().data(), flattened.size());
}

bool clipboardSupportsType(const String& type)
{
    // MIME types are compared by their lowercased serialization.
    auto lowered = type.convertToASCIILowercase();
    Bun::UTF8View utf8(lowered);
    auto bytes = utf8.bytes();
    return Bun__Clipboard__supportsType(bytes.data(), bytes.size());
}

bool clipboardWritesSingleRepresentation()
{
    return Bun__Clipboard__writesSingleRepresentation();
}

} // namespace WebCore

// JS thread: settles one scheduled operation. Adopts the job's JS-side
// reference, so completing a request is also what releases that side.
extern "C" void Bun__Clipboard__requestComplete(JSC::JSGlobalObject* globalObject, WebCore::ClipboardRequest* request, const WebCore::ClipboardRepresentation* representations, size_t count, const uint8_t* failureMessage, size_t failureLength)
{
    Ref<WebCore::ClipboardRequest> adopted = adoptRef(*request);
    WTF::String message;
    if (failureMessage)
        message = WTF::String::fromUTF8({ failureMessage, failureLength });
    adopted->complete(*globalObject, { representations, count }, message);
}

// JS thread, the job's completion is being dropped unrun (its VM has begun
// stopping): the captures are released here while their heap is alive. A
// write's off-thread reference may still hold the (now inert) request.
extern "C" void Bun__Clipboard__requestAbandon(WebCore::ClipboardRequest* request)
{
    Ref<WebCore::ClipboardRequest> adopted = adoptRef(*request);
    adopted->abandon();
}

// A write's off-thread reference: taken on the JS thread at schedule, dropped
// wherever the job's off-thread half ends up being dropped (ThreadSafeRefCounted;
// by then the completion has been run or released on the JS thread).
extern "C" void Bun__Clipboard__requestRef(WebCore::ClipboardRequest* request)
{
    request->ref();
}

extern "C" void Bun__Clipboard__requestDeref(WebCore::ClipboardRequest* request)
{
    request->deref();
}

// Read on a pool thread (atomic); the off-thread reference keeps `request` alive.
extern "C" bool Bun__Clipboard__requestIsCancelled(WebCore::ClipboardRequest* request)
{
    return request->isCancelled();
}
