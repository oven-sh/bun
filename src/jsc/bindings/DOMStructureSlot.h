#pragma once

#include <cstdint>

namespace WebCore {

// Every wrapper class whose Structure is cached on the global object gets one fixed slot here.
#define FOR_EACH_DOM_STRUCTURE_SLOT(macro)                                                                                                                                                                                                                                           \
    macro(JSAbortController)                                                                                                                                                                                                                                                         \
        macro(JSAbortSignal)                                                                                                                                                                                                                                                         \
            macro(JSBroadcastChannel)                                                                                                                                                                                                                                                \
                macro(JSByteLengthQueuingStrategy)                                                                                                                                                                                                                                   \
                    macro(JSCloseEvent)                                                                                                                                                                                                                                              \
                        macro(JSCompressionStream)                                                                                                                                                                                                                                   \
                            macro(JSCookie)                                                                                                                                                                                                                                          \
                                macro(JSCookieMap)                                                                                                                                                                                                                                   \
                                    macro(JSCountQueuingStrategy)                                                                                                                                                                                                                    \
                                        macro(JSCryptoKey)                                                                                                                                                                                                                           \
                                            macro(JSCustomEvent)                                                                                                                                                                                                                     \
                                                macro(JSDOMException)                                                                                                                                                                                                                \
                                                    macro(JSDOMFormData)                                                                                                                                                                                                             \
                                                        macro(JSDOMURL)                                                                                                                                                                                                              \
                                                            macro(JSDecompressionStream)                                                                                                                                                                                             \
                                                                macro(JSErrorEvent)                                                                                                                                                                                                  \
                                                                    macro(JSEvent)                                                                                                                                                                                                   \
                                                                        macro(JSEventEmitter)                                                                                                                                                                                        \
                                                                            macro(JSEventTarget)                                                                                                                                                                                     \
                                                                                macro(JSFetchHeaders)                                                                                                                                                                                \
                                                                                    macro(JSMessageChannel)                                                                                                                                                                          \
                                                                                        macro(JSMessageEvent)                                                                                                                                                                        \
                                                                                            macro(JSMessagePort)                                                                                                                                                                     \
                                                                                                macro(JSPerformance)                                                                                                                                                                 \
                                                                                                    macro(JSPerformanceEntry)                                                                                                                                                        \
                                                                                                        macro(JSPerformanceMark)                                                                                                                                                     \
                                                                                                            macro(JSPerformanceMeasure)                                                                                                                                              \
                                                                                                                macro(JSPerformanceObserver)                                                                                                                                         \
                                                                                                                    macro(JSPerformanceObserverEntryList)                                                                                                                            \
                                                                                                                        macro(JSPerformanceResourceTiming)                                                                                                                           \
                                                                                                                            macro(JSPerformanceServerTiming)                                                                                                                         \
                                                                                                                                macro(JSPerformanceTiming)                                                                                                                           \
                                                                                                                                    macro(JSReadableArrayBufferSinkController)                                                                                                       \
                                                                                                                                        macro(JSReadableFetchRequestBodySinkController)                                                                                              \
                                                                                                                                            macro(JSReadableFileSinkController)                                                                                                      \
                                                                                                                                                macro(JSReadableHTMLRewriterSinkController)                                                                                          \
                                                                                                                                                    macro(JSReadableHTTPResponseSinkController)                                                                                      \
                                                                                                                                                        macro(JSReadableHTTPSResponseSinkController)                                                                                 \
                                                                                                                                                            macro(JSReadableNetworkSinkController)                                                                                   \
                                                                                                                                                                macro(JSReadableByteStreamController)                                                                                \
                                                                                                                                                                    macro(JSReadableStream)                                                                                          \
                                                                                                                                                                        macro(JSReadableStreamAsyncIterator)                                                                         \
                                                                                                                                                                            macro(JSReadableStreamBYOBReader)                                                                        \
                                                                                                                                                                                macro(JSReadableStreamBYOBRequest)                                                                   \
                                                                                                                                                                                    macro(JSReadableStreamDefaultController)                                                         \
                                                                                                                                                                                        macro(JSReadableStreamDefaultReader)                                                         \
                                                                                                                                                                                            macro(JSSubtleCrypto)                                                                    \
                                                                                                                                                                                                macro(JSTextDecoderStream)                                                           \
                                                                                                                                                                                                    macro(JSTextEncoder)                                                             \
                                                                                                                                                                                                        macro(JSTextEncoderStream)                                                   \
                                                                                                                                                                                                            macro(JSTransformStream)                                                 \
                                                                                                                                                                                                                macro(JSTransformStreamDefaultController)                            \
                                                                                                                                                                                                                    macro(JSURLPattern)                                              \
                                                                                                                                                                                                                        macro(JSURLSearchParams)                                     \
                                                                                                                                                                                                                            macro(JSWasmStreamingCompiler)                           \
                                                                                                                                                                                                                                macro(JSWebSocket)                                   \
                                                                                                                                                                                                                                    macro(JSWorker)                                  \
                                                                                                                                                                                                                                        macro(JSWritableStream)                      \
                                                                                                                                                                                                                                            macro(JSWritableStreamDefaultController) \
                                                                                                                                                                                                                                                macro(JSWritableStreamDefaultWriter)

#define DOM_STRUCTURE_SLOT_FORWARD_DECLARE(name) class name;
FOR_EACH_DOM_STRUCTURE_SLOT(DOM_STRUCTURE_SLOT_FORWARD_DECLARE)
#undef DOM_STRUCTURE_SLOT_FORWARD_DECLARE

enum class DOMStructureSlot : uint8_t {
#define DOM_STRUCTURE_SLOT_ENUMERATE(name) name,
    FOR_EACH_DOM_STRUCTURE_SLOT(DOM_STRUCTURE_SLOT_ENUMERATE)
#undef DOM_STRUCTURE_SLOT_ENUMERATE
    // TU-local JSDOMIterator subclasses; each specializes DOMStructureSlotOf next to its definition.
    CookieMapIterator,
    DOMFormDataIterator,
    FetchHeadersIterator,
    URLSearchParamsIterator,
    Count,
};

template<typename WrapperClass> struct DOMStructureSlotOf;

#define DOM_STRUCTURE_SLOT_SPECIALIZE(name)                               \
    template<> struct DOMStructureSlotOf<name> {                          \
        static constexpr DOMStructureSlot value = DOMStructureSlot::name; \
    };
FOR_EACH_DOM_STRUCTURE_SLOT(DOM_STRUCTURE_SLOT_SPECIALIZE)
#undef DOM_STRUCTURE_SLOT_SPECIALIZE

} // namespace WebCore
