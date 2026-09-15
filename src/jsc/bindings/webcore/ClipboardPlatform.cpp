#include "config.h"
#include "ClipboardPlatform.h"

#include "BunString.h"
#include "ClipboardBlob.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/Vector.h>

namespace WebCore {

// Handed to the backend job, which completes or releases it on the JS thread.
struct ClipboardRequest {
    ClipboardCompletion completion;
};

extern "C" void Bun__Clipboard__scheduleReadText(JSC::JSGlobalObject*, ClipboardRequest*);
extern "C" void Bun__Clipboard__scheduleRead(JSC::JSGlobalObject*, ClipboardRequest*);
// Copies every byte range before returning.
extern "C" void Bun__Clipboard__scheduleWrite(JSC::JSGlobalObject*, ClipboardRequest*, const ClipboardRepresentation*, size_t count);

static ClipboardRequest* createRequest(ClipboardCompletion&& completion)
{
    return new ClipboardRequest { WTF::move(completion) };
}

std::optional<ClipboardMIMEType> clipboardMIMETypeFromEssence(StringView essence)
{
    if (essence == "text/plain"_s)
        return ClipboardMIMEType::TextPlain;
    if (essence == "text/html"_s)
        return ClipboardMIMEType::TextHtml;
    if (essence == "image/png"_s)
        return ClipboardMIMEType::ImagePng;
    return std::nullopt;
}

ASCIILiteral clipboardMIMETypeString(ClipboardMIMEType type)
{
    switch (type) {
    case ClipboardMIMEType::TextPlain:
        return "text/plain"_s;
    case ClipboardMIMEType::TextHtml:
        return "text/html"_s;
    case ClipboardMIMEType::ImagePng:
        return "image/png"_s;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void scheduleClipboardReadText(JSC::JSGlobalObject& globalObject, ClipboardCompletion&& completion)
{
    Bun__Clipboard__scheduleReadText(&globalObject, createRequest(WTF::move(completion)));
}

void scheduleClipboardRead(JSC::JSGlobalObject& globalObject, ClipboardCompletion&& completion)
{
    Bun__Clipboard__scheduleRead(&globalObject, createRequest(WTF::move(completion)));
}

void scheduleClipboardWriteText(JSC::JSGlobalObject& globalObject, const String& text, ClipboardCompletion&& completion)
{
    Bun::UTF8View utf8(text);
    auto bytes = utf8.bytes();
    ClipboardRepresentation representation { ClipboardMIMEType::TextPlain, bytes.data(), bytes.size() };
    Bun__Clipboard__scheduleWrite(&globalObject, createRequest(WTF::move(completion)), &representation, 1);
}

void scheduleClipboardWrite(JSC::JSGlobalObject& globalObject, const ClipboardItemData& data, ClipboardCompletion&& completion)
{
    Vector<ClipboardRepresentation> representations;
    representations.reserveInitialCapacity(data.size());
    for (auto& entry : data) {
        auto bytes = clipboardBlobBytes(entry.value.get());
        auto type = clipboardMIMETypeFromEssence(ClipboardItem::parseMIMETypeEssence(entry.key));
        RELEASE_ASSERT(type);
        representations.append({ *type, bytes.data(), bytes.size() });
    }
    Bun__Clipboard__scheduleWrite(&globalObject, createRequest(WTF::move(completion)), representations.span().data(), representations.size());
}

} // namespace WebCore

// JS thread: runs the request's completion once and frees it.
extern "C" void Bun__Clipboard__requestComplete(JSC::JSGlobalObject* globalObject, WebCore::ClipboardRequest* request, const WebCore::ClipboardRepresentation* representations, size_t count, const uint8_t* failureMessage, size_t failureLength)
{
    std::unique_ptr<WebCore::ClipboardRequest> adopted { request };
    WTF::String message;
    if (failureMessage)
        message = WTF::String::fromUTF8({ failureMessage, failureLength });
    adopted->completion(*globalObject, { representations, count }, message);
}

// JS thread, the VM is stopping: frees the request without running its completion.
extern "C" void Bun__Clipboard__requestRelease(WebCore::ClipboardRequest* request)
{
    delete request;
}
