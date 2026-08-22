#include "config.h"
#include "WebStreamsInternals.h"

#include "ErrorCode.h"
#include "ExceptionCode.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultController.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGeneratedClasses.h"
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

// A JSReadableStream's tag and native source. Pure: no scope, no traps, no script.
static int32_t tagOfStream(JSReadableStream* stream, void** ptr)
{
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

extern "C" bool ReadableStream__isNativeSourceConsumed(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    return stream && stream->nativeSourceConsumed();
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

extern "C" void ReadableStream__detach(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;
    stream->m_nativePtr.set(globalObject->vm(), stream, jsNumber(-1));
    stream->m_disturbed = true;
}

// A native sink (fetch body / S3 / FileSink) has attached directly without a reader.
// Mark the stream disturbed+locked so .locked, .getReader(), and the body-mixin
// disturbed checks behave as they do after readStreamIntoSink acquires a reader.
extern "C" void ReadableStream__lockNative(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*)
{
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(possibleReadableStream));
    if (!stream) [[unlikely]]
        return;
    stream->m_disturbed = true;
    stream->m_lockedWithoutReader = true;
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

extern "C" JSC::EncodedJSValue ReadableStream__used(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = createReadableStream(globalObject, SourceKind::Nothing, nullptr, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
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
