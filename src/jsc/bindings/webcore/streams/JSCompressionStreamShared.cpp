#include "config.h"
#include "JSCompressionStreamShared.h"

#include "ErrorCode.h"
#include "JSCompressionStream.h"
#include "JSDecompressionStream.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultController.h"
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
using WebCore::JSReadableStreamDefaultController;
using WebCore::JSStreamsRuntime;
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

// ─── Stepping a chunk through the coder ─────────────────────────────────────
//
// The coder emits a chunk (or the flush) in steps of bounded output (CompressionStreamCoder.rs).
// A chunk its first step finishes completes synchronously like any other arm; otherwise it
// stays pending on the stream (m_codecPromise) and is stepped again from later turns, once
// the readable or the native sink has room for more. The coder holds a pending chunk's state,
// so ClearAlgorithms defers the coder release to the chunk's terminal.

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
    // The coder stopped at its output cap; the chunk needs another step.
    bool more { false };
    bool sinkBackpressure { false };
    // Codec error or failed delivery; empty on success (and on VM termination).
    JSValue thrown;
};

enum class CodecVerdict : uint8_t {
    // Complete, or the rest of its output has no consumer left.
    Done,
    Failed,
    // Complete, but the sink is full: the chunk's promise settles when the sink drains.
    AwaitSink,
    // More output pending and the consumer is full; onCodecChunkResume continues it.
    ParkOnReadable,
    ParkOnSink,
    // More output pending and room for it.
    Step,
};

// Whether the rest of a pending chunk's output still has somewhere to go (false once the
// readable was cancelled or errored under it, or its native-sink pump finished and detached).
static bool codecOutputWanted(JSTransformStream* stream)
{
    auto* readable = stream->m_readable.get();
    if (readable->m_state != ReadableStreamState::Readable)
        return false;
    if (stream->m_nativeSinkPtr)
        return true;
    if (readable->m_controllerKind != ControllerKind::Default)
        return false;
    auto* controller = uncheckedDowncast<JSReadableStreamDefaultController>(readable->m_controller.get());
    return controller && readableStreamDefaultControllerCanCloseOrEnqueue(controller);
}

static CodecVerdict verdictAfterStep(JSTransformStream* stream, const CodecStepResult& step)
{
    if (!step.thrown.isEmpty())
        return CodecVerdict::Failed;
    // A sink that detached during the write will not signal again.
    bool sinkFull = step.sinkBackpressure && stream->m_nativeSinkPtr;
    if (!step.more)
        return sinkFull ? CodecVerdict::AwaitSink : CodecVerdict::Done;
    if (sinkFull)
        return CodecVerdict::ParkOnSink;
    if (!codecOutputWanted(stream))
        return CodecVerdict::Done;
    if (!stream->m_nativeSinkPtr && stream->m_backpressure)
        return CodecVerdict::ParkOnReadable;
    return CodecVerdict::Step;
}

// One step on this thread, delivered straight into the native JSSink when one is attached
// (no JSUint8Array), otherwise enqueued. `input` is only passed on a chunk's first step.
static CodecStepResult runStepHere(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, const uint8_t* input, size_t inputLen, bool finish)
{
    auto& vm = getVM(globalObject);
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    CodecStepResult step;
    if (void* sinkPtr = stream->m_nativeSinkPtr) {
        JSValue wrote = JSValue::decode(CompressionStreamCoder__transformInto(coder, globalObject, input, inputLen, finish, stream->m_nativeSinkId, sinkPtr, &step.more));
        if (!catchScope.exception())
            step.sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
    } else {
        JSValue out = JSValue::decode(CompressionStreamCoder__transform(coder, globalObject, input, inputLen, finish, &step.more));
        if (!catchScope.exception()) {
            auto* view = dynamicDowncast<JSArrayBufferView>(out);
            if (view && view->length())
                transformStreamDefaultControllerEnqueue(globalObject, stream->m_controller.get(), out);
        }
    }
    if (catchScope.exception()) [[unlikely]]
        step.thrown = takeAbruptCompletion(globalObject, catchScope);
    return step;
}

// Steps the chunk on this thread until it completes, fails, or has to wait (never returns
// Step). The caller holds m_nativeStateInUse: a terminal reached from inside a delivery then
// defers the coder release and the loop stops via codecOutputWanted instead.
static CodecVerdict stepChunkHere(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, const uint8_t* input, size_t inputLen, bool finish, JSValue& thrown)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_nativeStateInUse);
    for (;;) {
        CodecStepResult step = runStepHere(globalObject, stream, coder, input, inputLen, finish);
        RETURN_IF_EXCEPTION(scope, CodecVerdict::Failed);
        CodecVerdict verdict = verdictAfterStep(stream, step);
        if (verdict != CodecVerdict::Step) {
            thrown = step.thrown;
            return verdict;
        }
        input = nullptr;
        inputLen = 0;
    }
}

static void dispatchStepOffThread(JSGlobalObject* globalObject, JSTransformStream* stream, void* coder, JSValue chunk, const uint8_t* input, size_t inputLen, bool finish)
{
    stream->m_asyncCodecInFlight = true;
    CompressionStreamCoder__transformAsync(coder, globalObject, JSValue::encode(stream), JSValue::encode(chunk), input, inputLen, finish);
}

// Terminal of a pending chunk; `thrown` empty means fulfilled.
static void settleCodecChunk(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue thrown)
{
    auto* promise = stream->m_codecPromise.get();
    stream->m_codecPromise.clear();
    stream->m_codecChunkOffThread = false;
    nativeTransformReleaseStateIfIdle(stream);
    ASSERT(promise);
    if (!promise) [[unlikely]]
        return;
    if (!thrown.isEmpty())
        rejectPromise(globalObject, promise, thrown);
    else
        resolvePromise(globalObject, promise, jsUndefined());
}

// CodecVerdict::AwaitSink: the chunk's promise becomes m_nativeSinkReadyPromise, which the
// sink's onReady (or detaching from the sink) resolves. The coder is idle from here on.
static JSPromise* completeChunkWhenSinkDrains(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    auto& vm = getVM(globalObject);
    auto* promise = stream->m_codecPromise.get();
    stream->m_codecPromise.clear();
    stream->m_codecChunkOffThread = false;
    if (!promise)
        promise = JSPromise::create(vm, globalObject->promiseStructure());
    stream->m_nativeSinkReadyPromise.set(vm, stream, promise);
    nativeTransformReleaseStateIfIdle(stream);
    return promise;
}

// CodecVerdict::ParkOnReadable / ParkOnSink: registers onCodecChunkResume on the readable's
// [[backpressureChangePromise]] (resolved by its pull and, via transformStreamUnblockWrite, by
// every error/cancel terminal, including the cancel-after-close branch of
// transformStreamDefaultSourceCancelAlgorithm) or on a gate in m_nativeSinkReadyPromise
// (resolved by the sink's onReady or by detaching from it). Returns the chunk's promise.
static JSPromise* parkCodecChunk(JSGlobalObject* globalObject, JSTransformStream* stream, CodecVerdict wait)
{
    auto& vm = getVM(globalObject);
    if (!stream->m_codecPromise)
        stream->m_codecPromise.set(vm, stream, JSPromise::create(vm, globalObject->promiseStructure()));
    JSPromise* gate;
    if (wait == CodecVerdict::ParkOnSink) {
        ASSERT(!stream->m_nativeSinkReadyPromise);
        gate = JSPromise::create(vm, globalObject->promiseStructure());
        stream->m_nativeSinkReadyPromise.set(vm, stream, gate);
    } else {
        ASSERT(wait == CodecVerdict::ParkOnReadable);
        ASSERT(stream->m_backpressure);
        gate = stream->m_backpressureChangePromise.get();
        ASSERT(gate);
    }
    auto* runtime = JSStreamsRuntime::from(globalObject);
    gate->performPromiseThenWithContext(vm, globalObject, runtime->onCodecChunkResume(), jsUndefined(), jsUndefined(), stream);
    return stream->m_codecPromise.get();
}

// Applies a step's verdict to a chunk that is already pending (m_codecPromise set).
static void continuePendingChunk(JSGlobalObject* globalObject, JSTransformStream* stream, CodecVerdict verdict, JSValue thrown)
{
    switch (verdict) {
    case CodecVerdict::Done:
    case CodecVerdict::Failed:
        settleCodecChunk(globalObject, stream, thrown);
        return;
    case CodecVerdict::AwaitSink:
        completeChunkWhenSinkDrains(globalObject, stream);
        return;
    case CodecVerdict::ParkOnReadable:
    case CodecVerdict::ParkOnSink:
        parkCodecChunk(globalObject, stream, verdict);
        return;
    case CodecVerdict::Step:
        break;
    }
    // stepChunkHere loops on Step itself; an off-thread chunk's next step goes to the pool too.
    ASSERT(stream->m_codecChunkOffThread);
    dispatchStepOffThread(globalObject, stream, coderOf(stream), jsUndefined(), nullptr, 0, false);
}

// The transform / flush arm (under runNativeArm). Abrupt completions become a rejected
// promise: an arm must never throw synchronously into ProcessWrite/ProcessClose.
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
        return promise;
    }

    JSValue thrown;
    CodecVerdict verdict = stepChunkHere(globalObject, stream, coder, input, inputLen, finish, thrown);
    RETURN_IF_EXCEPTION(scope, nullptr);
    switch (verdict) {
    case CodecVerdict::Done:
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, jsUndefined()));
    case CodecVerdict::Failed:
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    case CodecVerdict::AwaitSink:
        RELEASE_AND_RETURN(scope, completeChunkWhenSinkDrains(globalObject, stream));
    case CodecVerdict::ParkOnReadable:
    case CodecVerdict::ParkOnSink:
        RELEASE_AND_RETURN(scope, parkCodecChunk(globalObject, stream, verdict));
    case CodecVerdict::Step:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// The consumer a chunk was parked on has room again, or went away (see parkCodecChunk).
static void resumeCodecChunk(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!stream->m_codecPromise) [[unlikely]]
        return;
    void* coder = coderOf(stream);
    ASSERT(coder);
    if (!coder || !codecOutputWanted(stream)) {
        settleCodecChunk(globalObject, stream, JSValue());
        return;
    }
    if (stream->m_codecChunkOffThread) {
        dispatchStepOffThread(globalObject, stream, coder, jsUndefined(), nullptr, 0, false);
        return;
    }
    JSValue thrown;
    stream->m_nativeStateInUse = true;
    CodecVerdict verdict = stepChunkHere(globalObject, stream, coder, nullptr, 0, false, thrown);
    stream->m_nativeStateInUse = false;
    RETURN_IF_EXCEPTION(scope, void());
    continuePendingChunk(globalObject, stream, verdict, thrown);
}

template<typename JSStream>
static JSPromise* compressionStreamTransformImpl(JSGlobalObject* globalObject, JSStream* stream, JSValue chunk)
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
    RELEASE_AND_RETURN(scope, transformChunk(globalObject, stream, stream->m_coder, chunk, bytes->data(), bytes->size(), false));
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

// JS-thread completion of an off-thread step. `out` borrows the coder's buffer, so it is
// consumed BEFORE m_asyncCodecInFlight is cleared and the verdict may release or re-dispatch
// the coder.
extern "C" void Bun__CompressionStream__deliverAsync(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue streamCell, const uint8_t* out, size_t outLen, bool more, JSC::EncodedJSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSTransformStream>(JSValue::decode(streamCell));
    ASSERT(stream);
    if (!stream) [[unlikely]]
        return;
    ASSERT(stream->m_asyncCodecInFlight);

    CodecStepResult step;
    step.more = more;
    if (error) {
        step.thrown = JSValue::decode(error);
    } else if (outLen) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (void* sinkPtr = stream->m_nativeSinkPtr) {
            JSValue wrote = JSValue::decode(Bun__NativeTransformSink__writeBytes(stream->m_nativeSinkId, sinkPtr, globalObject, out, outLen));
            if (!catchScope.exception())
                step.sinkBackpressure = nativeSinkWriteIsBackpressure(vm, wrote);
        } else {
            auto copied = JSC::ArrayBuffer::tryCreate(std::span<const uint8_t>(out, outLen));
            if (!copied) [[unlikely]] {
                step.thrown = JSC::createOutOfMemoryError(globalObject);
            } else {
                auto* view = JSC::JSUint8Array::create(globalObject, globalObject->typedArrayStructure(JSC::TypeUint8, false), WTF::move(copied), 0, outLen);
                if (!catchScope.exception())
                    transformStreamDefaultControllerEnqueue(globalObject, stream->m_controller.get(), JSValue(view));
            }
        }
        if (catchScope.exception()) [[unlikely]]
            step.thrown = takeAbruptCompletion(globalObject, catchScope);
    }

    stream->m_asyncCodecInFlight = false;
    // VM termination: the chunk stays pending; teardown's finalizer releases the coder.
    RETURN_IF_EXCEPTION(scope, void());
    continuePendingChunk(globalObject, stream, verdictAfterStep(stream, step), step.thrown);
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;

// [reaction-convention] _CODEC group; context = the JSCompressionStream / JSDecompressionStream.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onCodecChunkResume, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<JSTransformStream>(callFrame->argument(1));
    Bun::WebStreams::resumeCodecChunk(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
