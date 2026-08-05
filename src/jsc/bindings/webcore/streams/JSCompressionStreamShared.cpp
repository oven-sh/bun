#include "config.h"
#include "JSCompressionStreamShared.h"

#include "ErrorCode.h"
#include "JSCompressionStream.h"
#include "JSDecompressionStream.h"
#include "JSSink.h"
#include "JSStreamsRuntime.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSCompressionStream;
using WebCore::JSDecompressionStream;
using WebCore::JSTransformStream;
using WebCore::JSTransformStreamDefaultController;

std::optional<CompressionFormat> parseCompressionFormat(JSGlobalObject* globalObject, JSValue formatValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String format = formatValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (format == "deflate"_s)
        return CompressionFormat::Deflate;
    if (format == "deflate-raw"_s)
        return CompressionFormat::DeflateRaw;
    if (format == "gzip"_s)
        return CompressionFormat::Gzip;
    if (format == "brotli"_s)
        return CompressionFormat::Brotli;
    if (format == "zstd"_s)
        return CompressionFormat::Zstd;
    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "format"_s, formatValue, "must be one of: deflate, deflate-raw, gzip, brotli, zstd"_s);
    return std::nullopt;
}

// BufferSource → (ptr, len). `scratch` owns the bytes when `chunk` is a string
// (Node-compat: node:zlib-backed CompressionStream accepts string chunks).
static std::optional<std::span<const uint8_t>> bufferSourceBytes(JSGlobalObject* globalObject, JSValue chunk, WTF::CString& scratch)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (chunk.isNull()) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_STREAM_NULL_VALUES, "May not write null values to stream"_s);
        return std::nullopt;
    }
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk)) {
        if (view->isDetached()) [[unlikely]] {
            throwTypeError(globalObject, scope, "Cannot transform a detached buffer"_s);
            return std::nullopt;
        }
        if (view->isShared()) [[unlikely]] {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
            return std::nullopt;
        }
        return std::span<const uint8_t>(static_cast<const uint8_t*>(view->vector()), view->byteLength());
    }
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(chunk)) {
        auto* impl = buffer->impl();
        if (!impl || impl->isDetached()) [[unlikely]] {
            throwTypeError(globalObject, scope, "Cannot transform a detached buffer"_s);
            return std::nullopt;
        }
        if (impl->isShared()) [[unlikely]] {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
            return std::nullopt;
        }
        return std::span<const uint8_t>(static_cast<const uint8_t*>(impl->data()), impl->byteLength());
    }
    if (chunk.isString()) {
        WTF::String s = asString(chunk)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        scratch = s.utf8();
        return std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(scratch.data()), scratch.length());
    }
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "chunk"_s, "BufferSource"_s, chunk);
    return std::nullopt;
}

static constexpr size_t kAsyncCodecThreshold = 128 * 1024;

// Runs the Rust coder and delivers the output. When a native JSSink is attached
// (m_nativeSinkPtr), the coder writes straight to it (no JSUint8Array); otherwise
// the result is enqueued on the readable. Abrupt completions become a rejected
// promise — a transform algorithm must never throw synchronously into
// ProcessWrite/ProcessClose.
static JSPromise* codeAndEnqueue(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, JSTransformStreamDefaultController* controller, JSValue chunk, const uint8_t* input, size_t inputLen, bool finish)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (inputLen > kAsyncCodecThreshold && coder) {
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        stream->m_asyncCodecPromise.set(vm, stream, promise);
        stream->m_asyncCodecInFlight = true;
        CompressionStreamCoder__transformAsync(coder, globalObject, JSValue::encode(stream), JSValue::encode(chunk), input, inputLen, finish);
        scope.assertNoException();
        return promise;
    }

    JSValue thrown;
    bool sinkBackpressure = false;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (void* sinkPtr = stream->m_nativeSinkPtr) {
            JSValue wrote = JSValue::decode(CompressionStreamCoder__transformInto(coder, globalObject, input, inputLen, finish, stream->m_nativeSinkId, sinkPtr));
            if (!catchScope.exception())
                sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
        } else {
            JSValue out = JSValue::decode(CompressionStreamCoder__transform(coder, globalObject, input, inputLen, finish));
            if (!catchScope.exception()) {
                auto* view = dynamicDowncast<JSArrayBufferView>(out);
                if (view && view->length())
                    transformStreamDefaultControllerEnqueue(globalObject, controller, out);
            }
        }
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    if (sinkBackpressure) {
        auto* ready = JSPromise::create(vm, globalObject->promiseStructure());
        stream->m_nativeSinkReadyPromise.set(vm, stream, ready);
        return ready;
    }
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

template<typename JSStream>
static JSPromise* compressionStreamTransformImpl(JSGlobalObject* globalObject, JSStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thrown;
    WTF::CString scratch;
    std::optional<std::span<const uint8_t>> bytes;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        bytes = bufferSourceBytes(globalObject, chunk, scratch);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    if (!bytes) [[unlikely]]
        return nullptr;
    RELEASE_AND_RETURN(scope, codeAndEnqueue(globalObject, stream, stream->m_coder, controller, chunk, bytes->data(), bytes->size(), false));
}

JSPromise* compressionStreamTransform(JSGlobalObject* globalObject, JSCompressionStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return compressionStreamTransformImpl(globalObject, stream, controller, chunk);
}

JSPromise* compressionStreamFlush(JSGlobalObject* globalObject, JSCompressionStream* stream, JSTransformStreamDefaultController* controller)
{
    return codeAndEnqueue(globalObject, stream, stream->m_coder, controller, jsUndefined(), nullptr, 0, true);
}

JSPromise* decompressionStreamTransform(JSGlobalObject* globalObject, JSDecompressionStream* stream, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    return compressionStreamTransformImpl(globalObject, stream, controller, chunk);
}

JSPromise* decompressionStreamFlush(JSGlobalObject* globalObject, JSDecompressionStream* stream, JSTransformStreamDefaultController* controller)
{
    return codeAndEnqueue(globalObject, stream, stream->m_coder, controller, jsUndefined(), nullptr, 0, true);
}

// JS-thread completion for the off-thread codec dispatched by codeAndEnqueue. `out[..outLen]`
// borrows the coder's reusable output buffer, so the bytes are consumed (sink-write or
// controller-enqueue) BEFORE `m_asyncCodecInFlight` is cleared and any deferred coder release
// runs. The transform-algorithm promise to settle is read from `m_asyncCodecPromise`.
extern "C" void Bun__CompressionStream__deliverAsync(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue streamCell, const uint8_t* out, size_t outLen, JSC::EncodedJSValue error)
{
    auto& vm = getVM(globalObject);
    auto* stream = dynamicDowncast<JSTransformStream>(JSValue::decode(streamCell));
    ASSERT(stream);
    if (!stream) [[unlikely]]
        return;
    auto* promise = stream->m_asyncCodecPromise.get();
    stream->m_asyncCodecPromise.clear();
    ASSERT(promise);

    JSValue thrown;
    bool sinkBackpressure = false;
    if (!error) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (void* sinkPtr = stream->m_nativeSinkPtr) {
            if (outLen) {
                JSValue wrote = JSValue::decode(Bun__NativeTransformSink__writeBytes(stream->m_nativeSinkId, sinkPtr, globalObject, out, outLen));
                if (!catchScope.exception())
                    sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
            }
        } else if (outLen) {
            auto copied = JSC::ArrayBuffer::tryCreate(std::span<const uint8_t>(out, outLen));
            if (!copied) [[unlikely]] {
                thrown = JSC::createOutOfMemoryError(globalObject);
            } else {
                auto* view = JSC::JSUint8Array::create(globalObject, globalObject->typedArrayStructure(JSC::TypeUint8, false), WTF::move(copied), 0, outLen);
                if (!catchScope.exception())
                    transformStreamDefaultControllerEnqueue(globalObject, stream->m_controller.get(), JSValue(view));
            }
        }
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }

    stream->m_asyncCodecInFlight = false;
    if (stream->m_nativeStateReleasePending && !stream->m_nativeStateInUse) [[unlikely]]
        nativeTransformReleaseState(stream);

    if (!promise) [[unlikely]]
        return;
    if (error) {
        rejectPromise(globalObject, promise, JSValue::decode(error));
        return;
    }
    if (!thrown.isEmpty()) {
        rejectPromise(globalObject, promise, thrown);
        return;
    }
    if (sinkBackpressure) {
        stream->m_nativeSinkReadyPromise.set(vm, stream, promise);
        return;
    }
    resolvePromise(globalObject, promise, jsUndefined());
}

} // namespace WebStreams
} // namespace Bun
