#include "config.h"
#include "WebStreamsInternals.h"

#include "ErrorCode.h"
#include "ExceptionCode.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSReadRequest.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSReadableStreamDefaultController.h"
#include "JSStreamsRuntime.h"
#include "JSTransformStream.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultController.h"
#include "JSReadableStreamDefaultController.h"
#include "WebCoreJSBuiltins.h"
#include "GeneratedReadableStream.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSPromise.h>

// The extern "C" / Rust FFI surface. Every symbol name, signature, and ReadableStreamTag
// discriminant (Invalid=-1, JavaScript=0, Blob=1, File=2, Direct=3 [never emitted], Bytes=4)
// is frozen by ReadableStream.rs's assert_ffi_discr!.

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSReadableStream;

// Shared brand check of every consumer entry point; throws ERR_INVALID_ARG_TYPE.
static JSReadableStream* toReadableStream(Zig::GlobalObject* globalObject, ThrowScope& scope, EncodedJSValue encodedStream)
{
    JSValue streamValue = JSValue::decode(encodedStream);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    return stream;
}

} // namespace WebStreams
} // namespace Bun

using namespace JSC;
using namespace WebCore;
using namespace Bun::WebStreams;
using Bun::Bindgen::Generated::JSBlobInternalReadableStreamSource;
using Bun::Bindgen::Generated::JSBytesInternalReadableStreamSource;
using Bun::Bindgen::Generated::JSFileInternalReadableStreamSource;

// A JSReadableStream's tag and native source. Pure: no scope, no traps, no script.
static int32_t tagOfStream(JSReadableStream* stream, void** ptr)
{
    // An errored stream reads as a JS stream: its readers get the stored error, which the native source does not have.
    if (stream->m_state == ReadableStreamState::Errored)
        return 0;
    // The RAW handle slot, not nativePtrForJS(): a transferred stream still tags.
    JSValue handle = stream->m_nativePtr.get();
    if (handle.isEmpty() || !handle.isCell())
        return 0;
    JSCell* handleCell = handle.asCell();
    if (auto* blobSource = dynamicDowncast<JSBlobInternalReadableStreamSource>(handleCell)) {
        *ptr = blobSource->wrapped();
        return 1;
    }
    if (auto* fileSource = dynamicDowncast<JSFileInternalReadableStreamSource>(handleCell)) {
        *ptr = fileSource->wrapped();
        return 2;
    }
    if (auto* bytesSource = dynamicDowncast<JSBytesInternalReadableStreamSource>(handleCell)) {
        *ptr = bytesSource->wrapped();
        return 4;
    }
    return 0;
}

// Re-tag a value known to be a stream (one a Strong/Weak handle holds). -1, `*ptr` untouched, if it is not one after all.
extern "C" int32_t ReadableStreamTag__taggedStream(JSC::EncodedJSValue value, void** ptr)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(value));
    return stream ? tagOfStream(stream, ptr) : -1;
}

extern "C" int32_t ReadableStreamTag__tagged(Zig::GlobalObject* globalObject, JSC::EncodedJSValue* possibleReadableStream, void** ptr)
{
    JSValue value = JSValue::decode(*possibleReadableStream);
    if (!value.isCell())
        return -1;
    JSObject* object = value.getObject();
    if (!object)
        return -1;

    auto& vm = JSC::getVM(globalObject);

    if (auto* stream = dynamicDowncast<JSReadableStream>(object))
        return tagOfStream(stream, ptr);

    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isNonHostAsyncGeneratorFunction(object)) {
        JSValue iteratorMethod = object->getIfPropertyExists(globalObject, vm.propertyNames->asyncIteratorSymbol);
        RETURN_IF_EXCEPTION(scope, -1);
        if (!iteratorMethod || !iteratorMethod.isCallable())
            return -1;
    }

    auto* stream = readableStreamFromAsyncIterator(globalObject, object);
    RETURN_IF_EXCEPTION(scope, -1);
    *possibleReadableStream = JSValue::encode(stream);
    return 0;
}

extern "C" bool ReadableStream__tee(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject, JSC::EncodedJSValue* possibleReadableStream1, JSC::EncodedJSValue* possibleReadableStream2)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return false;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Body clone tees with cloneForBranch2 = false (share chunk refs) like Node/Chrome/Firefox;
    // the spec's per-chunk StructuredClone makes an N-deep clone chain retain N copies of the body
    // (whatwg/streams#1156).
    auto branches = readableStreamTee(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, false);

    *possibleReadableStream1 = JSValue::encode(branches.first);
    *possibleReadableStream2 = JSValue::encode(branches.second);
    return true;
}

extern "C" bool ReadableStream__is(JSC::EncodedJSValue value)
{
    return !!dynamicDowncast<JSReadableStream>(JSValue::decode(value));
}

extern "C" bool ReadableStream__isDisturbed(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    return stream && stream->m_disturbed;
}

extern "C" bool ReadableStream__isLocked(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    return stream && isReadableStreamLocked(stream);
}

// cancel / cancelWithReason / error: the source's own cancel failure is the cancel promise's rejection
// (marked handled); anything thrown synchronously is left pending for the Rust wrapper (check_slow).
extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStream__cancel(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;
    // A direct/native consumer locks the stream without a reader; its teardown is owned by
    // the controller close/detach path, never by readableStreamCancel.
    if (!stream->m_reader)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue reason = WebCore::createDOMException(globalObject, WebCore::ExceptionCode::AbortError);
    RETURN_IF_EXCEPTION(scope, );
    auto* result = readableStreamCancel(globalObject, stream, reason);
    RETURN_IF_EXCEPTION(scope, );
    markPromiseAsHandled(vm, result);
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStream__cancelWithReason(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject, JSC::EncodedJSValue reason)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* result = readableStreamCancel(globalObject, stream, JSValue::decode(reason));
    RETURN_IF_EXCEPTION(scope, );
    markPromiseAsHandled(vm, result);
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStream__error(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject, JSC::EncodedJSValue reason)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;

    Bun::WebStreams::webStreamControllerError(globalObject, stream, JSValue::decode(reason));
}

// `source` is of a native class whose prototype has `pull` and `cancel`.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue ReadableStream__createForBytes(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedSource, double highWaterMark)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue source = JSValue::decode(encodedSource);
    JSObject* prototype = asObject(asObject(source)->getPrototypeDirect());
    UnderlyingSourceDict methods;
    methods.pull = prototype->getDirect(vm, WebCore::builtinNames(vm).pullPublicName());
    methods.cancel = prototype->getDirect(vm, WebCore::builtinNames(vm).cancelPublicName());
    auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *defaultGlobalObject(globalObject)));
    initializeReadableStream(stream);
    setUpReadableByteStreamControllerFromUnderlyingSource(globalObject, stream, source, methods, highWaterMark);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

static JSReadableByteStreamController* openByteController(JSC::EncodedJSValue value)
{
    auto* controller = uncheckedDowncast<JSReadableByteStreamController>(JSValue::decode(value));
    return controller->m_closeRequested || controller->m_stream->m_state != ReadableStreamState::Readable ? nullptr : controller;
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableByteStreamController__enqueue(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value, JSC::EncodedJSValue chunk)
{
    if (auto* controller = openByteController(value))
        readableByteStreamControllerEnqueue(globalObject, controller, uncheckedDowncast<JSC::JSArrayBufferView>(JSValue::decode(chunk)));
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableByteStreamController__close(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* controller = openByteController(value);
    if (!controller)
        return;
    readableByteStreamControllerClose(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, );
    if (!controller->m_pendingPullIntos.isEmpty())
        RELEASE_AND_RETURN(scope, readableByteStreamControllerRespond(globalObject, controller, 0));
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableByteStreamController__error(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value, JSC::EncodedJSValue reason)
{
    if (auto* controller = dynamicDowncast<JSReadableByteStreamController>(JSValue::decode(value)))
        readableByteStreamControllerError(globalObject, controller, JSValue::decode(reason));
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue ReadableStream__acquireReader(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(value));
    stream->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(acquireReadableStreamDefaultReader(globalObject, stream)));
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue ReadableStream__sourceOfBytes(JSC::EncodedJSValue value)
{
    auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(value));
    if (stream->m_controllerKind != ControllerKind::Byte || stream->m_disturbed)
        return JSValue::encode(jsUndefined());
    JSValue source = uncheckedDowncast<JSReadableByteStreamController>(stream->m_controller.get())->m_algorithms.underlyingObject.get();
    return JSValue::encode(source ? source : jsUndefined());
}

// A promise for the chunk itself, so that no `then` is looked up.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue ReadableStreamReader__read(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue reader)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    auto* request = JSReadRequest::create(vm, JSStreamsRuntime::from(globalObject)->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::Internal, promise);
    readableStreamDefaultReaderRead(globalObject, uncheckedDowncast<JSReadableStreamDefaultReader>(JSValue::decode(reader)), request);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStreamReader__cancel(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue reader, JSC::EncodedJSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* canceled = readableStreamReaderGenericCancel(globalObject, uncheckedDowncast<JSReadableStreamDefaultReader>(JSValue::decode(reader)), JSValue::decode(reason));
    RETURN_IF_EXCEPTION(scope, );
    canceled->markAsHandled();
}

// `end` is of a native class whose prototype has the methods of a source and of a sink.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Stream__createForValues(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedEnd, bool isReadable)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue end = JSValue::decode(encodedEnd);
    auto method = [&](ASCIILiteral name) { return asObject(asObject(end)->getPrototypeDirect())->getDirect(vm, Identifier::fromString(vm, name)); };
    if (isReadable) {
        auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *defaultGlobalObject(globalObject)));
        initializeReadableStream(stream);
        setUpReadableStreamDefaultControllerFromUnderlyingSource(globalObject, stream, end, { {}, method("pull"_s), method("cancel"_s), {}, {} }, 0, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(stream);
    }
    auto* stream = JSWritableStream::create(vm, WebCore::getDOMStructure<JSWritableStream>(vm, *defaultGlobalObject(globalObject)));
    initializeWritableStream(stream);
    setUpWritableStreamDefaultControllerFromUnderlyingSink(globalObject, stream, end, { {}, method("write"_s), method("close"_s), method("abort"_s) }, 1, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

static JSReadableStreamDefaultController* openControllerOf(JSC::EncodedJSValue value)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(value));
    auto* controller = stream ? dynamicDowncast<JSReadableStreamDefaultController>(stream->m_controller.get()) : nullptr;
    return controller && readableStreamDefaultControllerCanCloseOrEnqueue(controller) ? controller : nullptr;
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStream__enqueueValue(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue stream, JSC::EncodedJSValue chunk)
{
    if (auto* controller = openControllerOf(stream))
        readableStreamDefaultControllerEnqueue(globalObject, controller, JSValue::decode(chunk));
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStream__closeValues(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue stream)
{
    if (auto* controller = openControllerOf(stream))
        readableStreamDefaultControllerClose(globalObject, controller);
}

extern "C" [[ZIG_EXPORT(check_slow)]] void Stream__errorValues(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue stream, JSC::EncodedJSValue reason)
{
    if (auto* writable = dynamicDowncast<JSWritableStream>(JSValue::decode(stream)))
        writableStreamDefaultControllerErrorIfNeeded(globalObject, writable->m_controller.get(), JSValue::decode(reason));
    else if (auto* controller = openControllerOf(stream))
        readableStreamDefaultControllerError(globalObject, controller, JSValue::decode(reason));
}

extern "C" [[ZIG_EXPORT(check_slow)]] void ReadableStream__pipeTo(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue source, JSC::EncodedJSValue destination)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* readable = uncheckedDowncast<JSReadableStream>(JSValue::decode(source));
    readable->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    auto* piped = readableStreamPipeTo(globalObject, readable, uncheckedDowncast<JSWritableStream>(JSValue::decode(destination)), false, false, false);
    RETURN_IF_EXCEPTION(scope, );
    piped->markAsHandled();
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool WritableStream__is(JSC::EncodedJSValue value)
{
    return !!dynamicDowncast<JSWritableStream>(JSValue::decode(value));
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool WritableStream__isLocked(JSC::EncodedJSValue value)
{
    auto* stream = dynamicDowncast<JSWritableStream>(JSValue::decode(value));
    return stream && isWritableStreamLocked(stream);
}

extern "C" bool TransformStream__ends(JSC::EncodedJSValue value, JSC::EncodedJSValue* readable, JSC::EncodedJSValue* writable)
{
    JSValue stream = JSValue::decode(value);
    if (!stream.isCell() || stream.asCell()->classInfo() != JSTransformStream::info())
        return false;
    *readable = JSValue::encode(uncheckedDowncast<JSTransformStream>(stream)->m_readable.get());
    *writable = JSValue::encode(uncheckedDowncast<JSTransformStream>(stream)->m_writable.get());
    return true;
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue TransformStream__createFromEnds(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue readable, JSC::EncodedJSValue writable)
{
    auto& vm = JSC::getVM(globalObject);
    auto* stream = JSTransformStream::create(vm, WebCore::getDOMStructure<JSTransformStream>(vm, *defaultGlobalObject(globalObject)));
    stream->m_readable.set(vm, stream, uncheckedDowncast<JSReadableStream>(JSValue::decode(readable)));
    stream->m_writable.set(vm, stream, uncheckedDowncast<JSWritableStream>(JSValue::decode(writable)));
    return JSValue::encode(stream);
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool ReadableStreamReader__isEnd(JSC::EncodedJSValue fulfilledWith)
{
    return !!dynamicDowncast<JSReadRequest>(JSValue::decode(fulfilledWith));
}

// Closed with nothing ever read or attached: the queue was empty at close, so no byte can come out.
extern "C" bool ReadableStream__isClosedUnread(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    return stream && stream->m_state == ReadableStreamState::Closed && !stream->m_disturbed && !isReadableStreamLocked(stream);
}

// A Body consumer took this stream's contents; its spec reader is never released.
extern "C" void ReadableStream__markConsumedAsBody(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;
    stream->markConsumedAsBody();
}

// markConsumedAsBody for Rust `to_any_blob`, which took the payload of a stream nothing started: no reader exists to close it.
extern "C" void ReadableStream__closeConsumedAsBody(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;
    stream->markConsumedAsBody();
    ASSERT(!stream->m_reader);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
    readableStreamCloseIfPossible(globalObject, stream);
    scope.assertNoExceptionExceptTermination();
}

// The `lockedStream` slot (ReadableStream.bind.ts): the only way from a natively locked stream's source back to the stream.
static WriteBarrier<Unknown>* lockedStreamSlot(JSCell* handle)
{
    if (auto* bytesSource = dynamicDowncast<JSBytesInternalReadableStreamSource>(handle))
        return &bytesSource->m_lockedStream;
    if (auto* fileSource = dynamicDowncast<JSFileInternalReadableStreamSource>(handle))
        return &fileSource->m_lockedStream;
    return nullptr;
}

static void lockNative(JSC::VM& vm, JSReadableStream* stream)
{
    stream->m_disturbed = true;
    stream->m_lockedWithoutReader = true;
    JSValue handle = stream->m_nativePtr.get();
    if (handle.isEmpty() || !handle.isCell())
        return;
    if (auto* slot = lockedStreamSlot(handle.asCell()))
        slot->set(vm, handle.asCell(), stream);
}

// A native sink (fetch body / S3 / FileSink) has attached directly without a reader.
// Mark the stream disturbed+locked so .locked, .getReader(), and the body-mixin
// disturbed checks behave as they do after readStreamIntoSink acquires a reader.
extern "C" void ReadableStream__lockNative(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;
    lockNative(JSC::getVM(globalObject), stream);
}

// Like ReadableStream__lockNative, for a sink that's about to connect itself to the native source. It only
// locks a stream that hasn't started and isn't locked, because a started source already feeds a controller.
// Otherwise it returns false without changing anything, and the caller falls back to readStreamIntoSink.
extern "C" bool ReadableStream__tryLockNative(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream || stream->m_bunMode != BunStreamMode::NativePending || isReadableStreamLocked(stream))
        return false;
    lockNative(JSC::getVM(globalObject), stream);
    return true;
}

// The source of a stream that ReadableStream__lockNative locked dropped its sink: error the stream with `reason`, or close it if `reason` is empty.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__NativeStreamSource__endLockedStream(JSC::EncodedJSValue encodedHandle, Zig::GlobalObject* globalObject, JSC::EncodedJSValue reason)
{
    auto* slot = lockedStreamSlot(JSValue::decode(encodedHandle).asCell());
    if (!slot || !slot->get())
        return;
    auto* stream = uncheckedDowncast<JSReadableStream>(slot->get());
    slot->clear();

    JSValue error = JSValue::decode(reason);
    if (error.isEmpty())
        readableStreamCloseIfPossible(globalObject, stream);
    else
        Bun::WebStreams::webStreamControllerError(globalObject, stream, error);
}

extern "C" JSC::EncodedJSValue ReadableStream__empty(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = createReadableStream(globalObject, SourceKind::Nothing, nullptr, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    readableStreamClose(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

// A locked stand-in for a body's stream. `consumed`: the body was read to its end (closed, disturbed), not still being read.
extern "C" JSC::EncodedJSValue ReadableStream__used(Zig::GlobalObject* globalObject, bool consumed)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = createReadableStream(globalObject, SourceKind::Nothing, nullptr, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    if (consumed) {
        stream->m_disturbed = true;
        readableStreamClose(globalObject, stream);
        RETURN_IF_EXCEPTION(scope, {});
    }
    acquireReadableStreamDefaultReader(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

extern "C" JSC::EncodedJSValue ReadableStream__errored(Zig::GlobalObject* globalObject, JSC::EncodedJSValue reason)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = createReadableStream(globalObject, SourceKind::Nothing, nullptr, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    readableStreamError(globalObject, stream, JSValue::decode(reason));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__createNativeReadableStream(Zig::GlobalObject* globalObject, JSC::EncodedJSValue nativePtr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    initializeReadableStream(stream);
    // Nothing native runs until a consumer materializes the stream.
    stream->m_bunMode = BunStreamMode::NativePending;
    stream->m_nativePtr.set(vm, stream, JSValue::decode(nativePtr));
    return JSValue::encode(stream);
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__createNativeTextReadableStream(Zig::GlobalObject* globalObject, JSC::EncodedJSValue nativePtr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    initializeReadableStream(stream);
    stream->m_bunMode = BunStreamMode::NativePending;
    stream->m_nativeTextMode = true;
    stream->m_nativePtr.set(vm, stream, JSValue::decode(nativePtr));
    return JSValue::encode(stream);
}

extern "C" JSC::EncodedJSValue ReadableStream__fromDecodedText(Zig::GlobalObject* globalObject, JSC::EncodedJSValue string)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = createReadableStream(globalObject, SourceKind::Nothing, nullptr, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    auto* controller = uncheckedDowncast<JSReadableStreamDefaultController>(stream->m_controller.get());
    JSValue chunk = JSValue::decode(string);
    if (chunk.isString() && asString(chunk)->length()) {
        readableStreamDefaultControllerEnqueue(globalObject, controller, chunk);
        RETURN_IF_EXCEPTION(scope, {});
    }
    readableStreamDefaultControllerClose(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

extern "C" JSC::EncodedJSValue ReadableStream__textDecodeFrom(Zig::GlobalObject* globalObject, JSC::EncodedJSValue sourceValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* source = dynamicDowncast<JSReadableStream>(JSValue::decode(sourceValue));
    if (!source) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "Expected a ReadableStream"_s);
    auto* stream = readableStreamTextDecodeFrom(globalObject, source);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToArrayBuffer(Zig::GlobalObject* globalObject, JSC::EncodedJSValue streamValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toReadableStream(globalObject, scope, streamValue);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToArrayBuffer(globalObject, stream)));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToBytes(Zig::GlobalObject* globalObject, JSC::EncodedJSValue streamValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toReadableStream(globalObject, scope, streamValue);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToBytes(globalObject, stream)));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject* globalObject, JSC::EncodedJSValue streamValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toReadableStream(globalObject, scope, streamValue);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToText(globalObject, stream)));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToJSON(Zig::GlobalObject* globalObject, JSC::EncodedJSValue streamValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toReadableStream(globalObject, scope, streamValue);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToJSON(globalObject, stream)));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToBlob(Zig::GlobalObject* globalObject, JSC::EncodedJSValue streamValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toReadableStream(globalObject, scope, streamValue);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToBlob(globalObject, stream)));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToFormData(Zig::GlobalObject* globalObject, JSC::EncodedJSValue streamValue, JSC::EncodedJSValue contentType)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toReadableStream(globalObject, scope, streamValue);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToFormData(globalObject, stream, JSValue::decode(contentType))));
}
