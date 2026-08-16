#pragma once

// Boundary to Bun's platform backend (src/runtime/webcore/clipboard.rs). WebCore owns every
// promise/JS value; the backend sees only byte ranges + an opaque request handle.

#include "root.h"
#include "ClipboardItemData.h"
#include <atomic>
#include <span>
#include <wtf/Function.h>
#include <wtf/ThreadSafeRefCounted.h>
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

// One outstanding platform clipboard operation. The backend job's JS side
// owns the completion (run or released on the JS thread only); a write's
// off-thread side holds a second reference so the pool thread can read the
// cancel flag. Whichever reference drops last may be off the JS thread, hence
// ThreadSafeRefCounted; by then the completion has already been run or
// released on the JS thread.
class ClipboardRequest : public ThreadSafeRefCounted<ClipboardRequest> {
public:
    // Runs on the JS thread when done. Empty `representations` is not an error; `failureMessage`
    // is null on success. `Function` (not `CompletionHandler`): a VM that shuts down while the
    // job is out drops the request without a live global to call it with.
    using Completion = Function<void(JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage)>;

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

    // JS thread, the job came back to a VM that has begun stopping: release
    // the promise and clipboard the completion captured while their heap is
    // still alive, without running it.
    void abandon() { m_completion = {}; }

    // The backend checks this under its write lock before touching the
    // platform, so a superseded write (whose AbortError must not be a lie)
    // never reaches the OS clipboard.
    void cancel() { m_cancelled.store(true, std::memory_order_relaxed); }
    bool isCancelled() const { return m_cancelled.load(std::memory_order_relaxed); }

private:
    explicit ClipboardRequest(Completion&& completion)
        : m_completion(WTF::move(completion))
    {
    }

    Completion m_completion;
    std::atomic<bool> m_cancelled { false };
};

// Schedule a platform operation. Each consumes a reference, which becomes the
// backend job's JS side; the backend takes its own off-thread reference.
void scheduleClipboardReadText(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&);
void scheduleClipboardRead(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&);
void scheduleClipboardWriteText(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&, const String& text);
void scheduleClipboardWrite(JSC::JSGlobalObject&, Ref<ClipboardRequest>&&, const ClipboardItemData&);

// The backend is the single source of truth for platform capability, so
// ClipboardItem.supports() and write()'s validation both ask it.
bool clipboardSupportsType(const String&);
bool clipboardWritesSingleRepresentation();

} // namespace WebCore
