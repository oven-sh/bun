
#include <wtf/FastMalloc.h>
#include <wtf/Noncopyable.h>

#pragma once

namespace WebCore {

enum class DOMConstructorID : uint16_t {
    AbortController,
    AbortSignal,
    BroadcastChannel,
    ByteLengthQueuingStrategy,
    Clipboard,
    ClipboardEvent,
    ClipboardItem,
    CloseEvent,
    CompressionStream,
    CountQueuingStrategy,
    CryptoKey,
    CustomEvent,
    DOMException,
    DOMFormData,
    DOMURL,
    DecompressionStream,
    ErrorEvent,
    Event,
    EventTarget,
    FetchHeaders,
    MessageChannel,
    MessageEvent,
    MessagePort,
    Performance,
    PerformanceEntry,
    PerformanceMark,
    PerformanceMeasure,
    PerformanceObserver,
    PerformanceObserverEntryList,
    PerformanceResourceTiming,
    PerformanceServerTiming,
    PerformanceTiming,
    ReadableByteStreamController,
    ReadableStream,
    ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
    SubtleCrypto,
    TextDecoderStream,
    TextEncoder,
    TextEncoderStream,
    TransformStream,
    TransformStreamDefaultController,
    URLSearchParams,
    WebSocket,
    Worker,
    WritableStream,
    WritableStreamDefaultController,
    WritableStreamDefaultWriter,

    // --bun--
    Cookie,
    CookieMap,
    EventEmitter,
    URLPattern,

    // Keep last. Sizes ConstructorArray.
    Count,
};

static constexpr unsigned numberOfDOMConstructors = static_cast<unsigned>(DOMConstructorID::Count);

class DOMConstructors {
    WTF_MAKE_NONCOPYABLE(DOMConstructors);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(DOMConstructors);

public:
    using ConstructorArray = std::array<JSC::WriteBarrier<JSC::JSObject>, numberOfDOMConstructors>;
    DOMConstructors() = default;
    ConstructorArray& array() { return m_array; }
    const ConstructorArray& array() const { return m_array; }
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(m_array.begin(), m_array.end());
    }

private:
    ConstructorArray m_array {};
};

} // namespace WebCore
