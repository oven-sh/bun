#include "config.h"
#include "JSCompressionStreamShared.h"
#include "BunClientData.h"

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
#include <limits>

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

// Default for the optional second constructor argument; the same default output size as the
// node:zlib stream adapter (src/js/internal/streams/iter/transform.ts).
static constexpr double kDefaultCodecHighWaterMark = 64 * 1024;

size_t parseCodecHighWaterMark(JSGlobalObject* globalObject, JSValue strategy)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    QueuingStrategyDict dict = convertQueuingStrategyDict(globalObject, strategy);
    RETURN_IF_EXCEPTION(scope, 0);
    double highWaterMark = extractHighWaterMark(globalObject, dict, kDefaultCodecHighWaterMark);
    RETURN_IF_EXCEPTION(scope, 0);
    // +Infinity (spec-legal) means "never split a chunk's output"; the coder floors at one byte.
    if (highWaterMark >= static_cast<double>(std::numeric_limits<size_t>::max()))
        return std::numeric_limits<size_t>::max();
    return static_cast<size_t>(highWaterMark);
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

// ─── Stepping a chunk through the coder ─────────────────────────────────────
//
// The coder emits a chunk (or the flush) in steps of at most the stream's highWaterMark
// (CompressionStreamCoder.rs). A chunk its first step finishes completes synchronously like
// any other arm. Otherwise its transform promise (m_codecPromise) stays pending, which keeps
// the write in flight and so the producer waiting, and the consumer drives the remaining
// steps: the readable's pull algorithm and the native sink's onReady call nativeCodecContinue;
// nativeCodecAbandon is called once the chunk can no longer finish, from whichever side goes
// away first: the writable starting to error with the write in flight (abort, transform
// errors), the readable being cancelled, or the sink detaching. The coder holds a pending
// chunk's state, so ClearAlgorithms defers the coder release meanwhile (the close algorithm
// clears algorithms while a multi-step flush is still being drained).

static void* coderOf(JSTransformStream* stream)
{
    if (auto* s = dynamicDowncast<JSCompressionStream>(stream))
        return s->m_coder;
    if (auto* s = dynamicDowncast<JSDecompressionStream>(stream))
        return s->m_coder;
    return nullptr;
}

// One step, with its output already handed to the consumer.
struct CodecStepResult {
    // The coder stopped at its output bound; the chunk needs another step.
    bool more { false };
    bool sinkBackpressure { false };
};

// One step on this thread, delivered straight into the native JSSink when one is attached
// (no JSUint8Array), otherwise enqueued. `input` is only passed on a chunk's first step. A codec
// error or failed delivery throws.
static CodecStepResult runStepHere(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, const uint8_t* input, size_t inputLen, bool finish)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CodecStepResult step;
    if (void* sinkPtr = stream->m_nativeSinkPtr) {
        JSValue wrote = JSValue::decode(CompressionStreamCoder__transformInto(coder, globalObject, input, inputLen, finish, stream->m_nativeSinkId, sinkPtr, &step.more));
        RETURN_IF_EXCEPTION(scope, step);
        step.sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
        return step;
    }
    JSValue out = JSValue::decode(CompressionStreamCoder__transform(coder, globalObject, input, inputLen, finish, &step.more));
    RETURN_IF_EXCEPTION(scope, step);
    auto* view = dynamicDowncast<JSArrayBufferView>(out);
    if (view && view->length()) {
        transformStreamDefaultControllerEnqueue(globalObject, stream->m_controller.get(), out);
        RETURN_IF_EXCEPTION(scope, step);
    }
    return step;
}

enum class CodecOutcome : uint8_t {
    Done,
    // Done, but its last write left the sink full: the transform promise becomes
    // m_nativeSinkReadyPromise and settles when the sink drains, as any backpressured write.
    DoneSinkFull,
    // Nothing to settle: output is still pending and the consumer is full (it will continue
    // the chunk), or a terminal reached from inside a delivery already abandoned it.
    Pending,
};

static bool consumerFull(JSTransformStream* stream, const CodecStepResult& step)
{
    return stream->m_nativeSinkPtr ? step.sinkBackpressure : stream->m_backpressure;
}

// Steps on this thread until the chunk completes, fails (throws), or its consumer is full. `input`
// is only fed on the first step. The caller holds m_nativeStateInUse, so a terminal reached from
// inside a delivery defers the coder release instead of freeing it under the loop.
static CodecOutcome stepChunkHere(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, const uint8_t* input, size_t inputLen, bool finish)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_nativeStateInUse);
    bool continuation = !!stream->m_codecPromise;
    for (;;) {
        CodecStepResult step = runStepHere(globalObject, stream, coder, input, inputLen, finish);
        RETURN_IF_EXCEPTION(scope, CodecOutcome::Pending);
        if (continuation && !stream->m_codecPromise)
            return CodecOutcome::Pending;
        bool full = consumerFull(stream, step);
        if (!step.more)
            return full && stream->m_nativeSinkPtr ? CodecOutcome::DoneSinkFull : CodecOutcome::Done;
        if (full)
            return CodecOutcome::Pending;
        input = nullptr;
        inputLen = 0;
    }
}

static void dispatchStepOffThread(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, JSValue chunk, const uint8_t* input, size_t inputLen, bool finish)
{
    stream->m_asyncCodecInFlight = true;
    CompressionStreamCoder__transformAsync(coder, globalObject, JSValue::encode(stream), JSValue::encode(chunk), input, inputLen, finish);
}

// Takes the pending chunk's promise off the stream; the coder is idle again, so a deferred
// release can go ahead.
static JSPromise* takeCodecPromise(JSTransformStream* stream)
{
    auto* promise = stream->m_codecPromise.get();
    stream->m_codecPromise.clear();
    stream->m_codecChunkOffThread = false;
    nativeTransformReleaseStateIfIdle(stream);
    return promise;
}

static void settleCodecChunk(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue thrown)
{
    auto* promise = takeCodecPromise(stream);
    ASSERT(promise);
    if (!promise) [[unlikely]]
        return;
    if (!thrown.isEmpty())
        rejectPromise(globalObject, promise, thrown);
    else
        resolvePromise(globalObject, promise, jsUndefined());
}

// Applies the outcome of a step that ran from a later turn to the pending chunk.
static void settlePendingChunk(JSGlobalObject* globalObject, JSTransformStream* stream, CodecOutcome outcome)
{
    auto& vm = getVM(globalObject);
    switch (outcome) {
    case CodecOutcome::Done:
        settleCodecChunk(globalObject, stream, JSValue());
        return;
    case CodecOutcome::DoneSinkFull:
        if (auto* promise = takeCodecPromise(stream))
            stream->m_nativeSinkReadyPromise.set(vm, stream, promise);
        return;
    case CodecOutcome::Pending:
        return;
    }
}

// The transform / flush arm (under runNativeArm). It returns a promise, so a failed step is its
// rejection: an arm must never throw synchronously into ProcessWrite/ProcessClose.
static JSPromise* transformChunk(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, JSValue chunk, const uint8_t* input, size_t inputLen, bool finish)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!stream->m_codecPromise);
    ASSERT(coder);

    if (inputLen > kAsyncCodecThreshold) {
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        stream->m_codecPromise.set(vm, stream, promise);
        stream->m_codecChunkOffThread = true;
        dispatchStepOffThread(globalObject, stream, coder, chunk, input, inputLen, finish);
        scope.assertNoException();
        return promise;
    }

    RELEASE_AND_RETURN(scope, promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(vm);
        CodecOutcome outcome = stepChunkHere(globalObject, stream, coder, input, inputLen, finish);
        RETURN_IF_EXCEPTION(scope, nullptr);
        switch (outcome) {
        case CodecOutcome::Done:
            RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, jsUndefined()));
        case CodecOutcome::DoneSinkFull: {
            auto* ready = JSPromise::create(vm, globalObject->promiseStructure());
            stream->m_nativeSinkReadyPromise.set(vm, stream, ready);
            return ready;
        }
        case CodecOutcome::Pending: {
            auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
            stream->m_codecPromise.set(vm, stream, promise);
            return promise;
        }
        }
        RELEASE_ASSERT_NOT_REACHED();
    }));
}

void nativeCodecContinue(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_codecPromise);
    void* coder = coderOf(stream);
    ASSERT(coder);
    if (!coder) [[unlikely]]
        RELEASE_AND_RETURN(scope, settleCodecChunk(globalObject, stream, JSValue()));
    if (stream->m_codecChunkOffThread) {
        // A step already on the pool re-dispatches itself from deliverAsync while there is room.
        if (stream->m_asyncCodecInFlight)
            return;
        RELEASE_AND_RETURN(scope, dispatchStepOffThread(globalObject, stream, coder, jsUndefined(), nullptr, 0, false));
    }
    // This resumes the pending chunk on its behalf (atStreamsBoundary): a failed step is that
    // chunk's rejection. If a terminal reached inside the step already abandoned the chunk, that
    // terminal carries the error and there is nothing left to settle.
    atStreamsBoundary(globalObject, [&] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        stream->m_nativeStateInUse = true;
        CodecOutcome outcome = stepChunkHere(globalObject, stream, coder, nullptr, 0, false);
        stream->m_nativeStateInUse = false;
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, settlePendingChunk(globalObject, stream, outcome)); }, [&](JSValue thrown) {
        if (stream->m_codecPromise)
            settleCodecChunk(globalObject, stream, thrown); });
    RETURN_IF_EXCEPTION(scope, );
    // An abandon from inside the loop deferred its release to here.
    RELEASE_AND_RETURN(scope, nativeTransformReleaseStateIfIdle(stream));
}

void nativeCodecAbandon(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    if (!stream->m_codecPromise)
        return;
    // The in-flight write this chunk holds must still finish for the writable to reach its
    // own terminal; the output that was never consumed is dropped with the coder.
    settleCodecChunk(globalObject, stream, JSValue());
}

template<typename JSStream>
static JSPromise* compressionStreamTransformImpl(JSGlobalObject* globalObject, JSStream* stream, JSValue chunk)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        WTF::CString scratch;
        std::optional<std::span<const uint8_t>> bytes = bufferSourceBytes(globalObject, chunk, scratch);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!bytes) [[unlikely]]
            return nullptr;
        RELEASE_AND_RETURN(scope, transformChunk(globalObject, stream, stream->m_coder, chunk, bytes->data(), bytes->size(), false));
    });
}

JSPromise* compressionStreamTransform(JSGlobalObject* globalObject, JSCompressionStream* stream, JSTransformStreamDefaultController*, JSValue chunk)
{
    return compressionStreamTransformImpl(globalObject, stream, chunk);
}

JSPromise* compressionStreamFlush(JSGlobalObject* globalObject, JSCompressionStream* stream, JSTransformStreamDefaultController*)
{
    return transformChunk(globalObject, stream, stream->m_coder, jsUndefined(), nullptr, 0, true);
}

JSPromise* decompressionStreamTransform(JSGlobalObject* globalObject, JSDecompressionStream* stream, JSTransformStreamDefaultController*, JSValue chunk)
{
    return compressionStreamTransformImpl(globalObject, stream, chunk);
}

JSPromise* decompressionStreamFlush(JSGlobalObject* globalObject, JSDecompressionStream* stream, JSTransformStreamDefaultController*)
{
    return transformChunk(globalObject, stream, stream->m_coder, jsUndefined(), nullptr, 0, true);
}

// Hands an off-thread step's output to the consumer (native sink or readable). Throws on a failed
// delivery.
static CodecStepResult deliverAsyncOutput(JSGlobalObject* globalObject, JSTransformStream* stream, const uint8_t* out, size_t outLen, bool more)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CodecStepResult step;
    step.more = more;
    if (void* sinkPtr = stream->m_nativeSinkPtr) {
        JSValue wrote = JSValue::decode(Bun__NativeTransformSink__writeBytes(stream->m_nativeSinkId, sinkPtr, globalObject, out, outLen));
        RETURN_IF_EXCEPTION(scope, step);
        step.sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
        return step;
    }
    auto copied = JSC::ArrayBuffer::tryCreate(std::span<const uint8_t>(out, outLen));
    if (!copied) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return step;
    }
    auto* view = JSC::JSUint8Array::create(globalObject, globalObject->typedArrayStructure(JSC::TypeUint8, false), WTF::move(copied), 0, outLen);
    RETURN_IF_EXCEPTION(scope, step);
    transformStreamDefaultControllerEnqueue(globalObject, stream->m_controller.get(), JSValue(view));
    RETURN_IF_EXCEPTION(scope, step);
    return step;
}

// JS-thread completion of an off-thread step. `out` borrows the coder's buffer, so it is
// consumed BEFORE m_asyncCodecInFlight is cleared and the coder may be released or
// re-dispatched. Entered from the event loop with no JS above it (a TopExceptionScope, and
// atStreamsBoundary for the delivery): a failed delivery is the pending chunk's rejection.
extern "C" void Bun__CompressionStream__deliverAsync(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue streamCell, const uint8_t* out, size_t outLen, bool more, JSC::EncodedJSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTransformStream>(JSValue::decode(streamCell));
    ASSERT(stream);
    if (!stream) [[unlikely]]
        return;
    ASSERT(stream->m_asyncCodecInFlight);

    CodecStepResult step;
    step.more = more;
    JSValue thrown;
    if (error) {
        thrown = JSValue::decode(error);
    } else if (outLen && stream->m_codecPromise) {
        atStreamsBoundary(globalObject, [&] { step = deliverAsyncOutput(globalObject, stream, out, outLen, more); }, [&](JSValue error) { thrown = error; });
        if (scope.exception()) [[unlikely]] {
            // VM termination: the chunk stays pending; teardown's finalizer releases the coder.
            Bun__VM__takeTerminationOutsideScript(globalObject);
            stream->m_asyncCodecInFlight = false;
            return;
        }
    }

    stream->m_asyncCodecInFlight = false;
    // A terminal abandoned the chunk while this step ran (the delivery above may have been it).
    if (!stream->m_codecPromise) {
        nativeTransformReleaseStateIfIdle(stream);
        return;
    }
    if (thrown)
        settleCodecChunk(globalObject, stream, thrown);
    else if (!step.more)
        settlePendingChunk(globalObject, stream, consumerFull(stream, step) && stream->m_nativeSinkPtr ? CodecOutcome::DoneSinkFull : CodecOutcome::Done);
    else if (!consumerFull(stream, step)) {
        if (void* coder = coderOf(stream)) [[likely]]
            dispatchStepOffThread(globalObject, stream, coder, jsUndefined(), nullptr, 0, false);
        else
            settleCodecChunk(globalObject, stream, JSValue());
    }
    // Otherwise the consumer continues the chunk once it has room.
    scope.assertNoException();
}

} // namespace WebStreams
} // namespace Bun
