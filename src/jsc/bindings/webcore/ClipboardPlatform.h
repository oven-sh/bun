#pragma once

// The boundary between WebCore's Clipboard and Bun's platform clipboard backend
// (src/runtime/webcore/clipboard.rs). WebCore owns every promise and every JS
// value; the backend only ever sees byte ranges and an opaque request handle,
// which is what lets the platform work happen on the work pool.

#include "root.h"
#include "ClipboardItemData.h"
#include <span>
#include <wtf/CompletionHandler.h>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// One representation crossing the boundary: a MIME type and its bytes, both
// borrowed for the duration of the call.
struct ClipboardRepresentation {
    const uint8_t* type;
    size_t typeLength;
    const uint8_t* bytes;
    size_t length;
};

// One outstanding platform clipboard operation. Refcounted so the work-pool job
// can hold it across the thread hop; the backend treats it as an opaque handle
// and hands it back on the JS thread exactly once.
class ClipboardRequest : public RefCounted<ClipboardRequest> {
public:
    // Runs on the JS thread once the platform work is done. `representations` is
    // what the platform produced — empty is not an error, since a clipboard with
    // no matching representation simply has none. `failureMessage` is null on
    // success and otherwise the actionable reason to reject with.
    using Completion = CompletionHandler<void(JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage)>;

    static Ref<ClipboardRequest> create(Completion&& completion)
    {
        return adoptRef(*new ClipboardRequest(WTF::move(completion)));
    }

    // Runs the completion once and drops it, so a backend that reported twice
    // cannot settle a promise twice.
    void complete(JSC::JSGlobalObject& globalObject, std::span<const ClipboardRepresentation> representations, const String& failureMessage)
    {
        if (auto completion = std::exchange(m_completion, {}))
            completion(globalObject, representations, failureMessage);
    }

private:
    explicit ClipboardRequest(Completion&& completion)
        : m_completion(WTF::move(completion))
    {
    }

    Completion m_completion;
};

// Schedule a platform operation. Each consumes a reference, which the backend
// releases when it completes the request.
void scheduleClipboardReadText(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&);
void scheduleClipboardRead(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&);
void scheduleClipboardWriteText(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&, const String& text);
void scheduleClipboardWrite(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&, const ClipboardItemData&);

// The backend is the single source of truth for platform capability, so
// ClipboardItem.supports() and write()'s validation both ask it.
bool clipboardSupportsType(const String&);
bool clipboardWritesSingleRepresentation();

} // namespace WebCore
