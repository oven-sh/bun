#include "JSReadableHelper.h"
#include "JSReadableState.h"
#include "JSBufferList.h"
#include "JSBuffer.h"
#include "JSEventEmitter.h"
#include "JSStringDecoder.h"
#include "JavaScriptCore/Lookup.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "JSDOMAttribute.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"
#include "JavaScriptCore/StrongInlines.h"
#include "BunClientData.h"

namespace WebCore {
using namespace JSC;

#define JSReadableHelper_EXTRACT_STREAM_STATE                                                   \
    VM& vm = lexicalGlobalObject->vm();                                                         \
    auto throwScope = DECLARE_THROW_SCOPE(vm);                                                  \
                                                                                                \
    if (callFrame->argumentCount() < 2) {                                                       \
        throwTypeError(lexicalGlobalObject, throwScope, "Not enough arguments"_s);              \
        return JSValue::encode(jsUndefined());                                                  \
    }                                                                                           \
                                                                                                \
    JSObject* stream = callFrame->uncheckedArgument(0).toObject(lexicalGlobalObject);           \
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));                            \
    JSReadableState* state = jsCast<JSReadableState*>(callFrame->uncheckedArgument(1));         \
    if (!state) {                                                                               \
        throwTypeError(lexicalGlobalObject, throwScope, "Second argument not ReadableState"_s); \
        return JSValue::encode(jsUndefined());                                                  \
    }

static bool callRead(JSValue stream, JSFunction* read, JSC::MarkedArgumentBuffer&& args, JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, EventEmitter& emitter)
{
    WTF::NakedPtr<JSC::Exception> exceptionPtr;
    JSC::CallData callData = JSC::getCallData(read);
    JSValue ret = call(lexicalGlobalObject, read, callData, JSValue(stream), WTFMove(args), exceptionPtr);
    if (auto* exception = exceptionPtr.get()) {
        JSC::Identifier errorEventName = JSC::Identifier::fromString(vm, "error"_s);
        if (emitter.hasEventListeners(errorEventName)) {
            args.clear();
            JSValue val = exception->value();
            if (!val) {
                val = jsUndefined();
            }
            args.append(val);
            emitter.emitForBindings(errorEventName, args);
        } else {
            reportException(lexicalGlobalObject, exception);
        }
        return true;
    }

    return !ret.isUndefinedOrNull();
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_maybeReadMore, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        auto clientData
        = WebCore::clientData(vm);
    auto readIdentifier = clientData->builtinNames().readPublicName();
    auto read = stream->get(lexicalGlobalObject, readIdentifier);

    auto callData = JSC::getCallData(read);
    if (callData.type == CallData::Type::None) {
        throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
        return JSValue::encode({});
    }

    auto* jsEmitter = jsEventEmitterCastFast(vm, lexicalGlobalObject, stream);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (UNLIKELY(!jsEmitter)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Stream must be an EventEmitter"_s);
        return JSValue::encode(JSValue {});
    }
    auto& emitter = jsEmitter->wrapped();

    while (
        !state->getBool(JSReadableState::reading) && !state->getBool(JSReadableState::ended) && (state->m_length < state->m_highWaterMark || (state->m_flowing > 0 && state->m_length == 0))) {
        int64_t len = state->m_length;
        MarkedArgumentBuffer args;
        args.append(jsNumber(0));

        callRead(stream, jsCast<JSFunction*>(read), WTFMove(args), vm, lexicalGlobalObject, emitter);

        if (len == state->m_length)
            break;
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

void flow(JSGlobalObject* lexicalGlobalObject, JSObject* streamObj, JSReadableState* state)
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto clientData = WebCore::clientData(vm);
    auto readIdentifier = clientData->builtinNames().readPublicName();
    auto read = streamObj->get(lexicalGlobalObject, readIdentifier);

    auto callData = JSC::getCallData(read);
    if (callData.type == CallData::Type::None) {
        throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
        return;
    }

    if (state->m_flowing > 0) {
        WebCore::EventEmitter& emitter = jsEventEmitterCastFast(vm, lexicalGlobalObject, streamObj)->wrapped();

        while (state->m_flowing > 0) {

            if (!callRead(streamObj, jsCast<JSFunction*>(read), MarkedArgumentBuffer(), vm, lexicalGlobalObject, emitter)) {
                break;
            }
        }
    }
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_resume, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        auto* jsEmitterWrap
        = jsEventEmitterCastFast(vm, lexicalGlobalObject, stream);

    if (UNLIKELY(!jsEmitterWrap)) {
        throwTypeError(lexicalGlobalObject, throwScope, "Stream must be an EventEmitter"_s);
        return JSValue::encode(JSValue {});
    }

    auto& emitter = jsEmitterWrap->wrapped();
    auto clientData = WebCore::clientData(vm);
    auto readIdentifier = clientData->builtinNames().readPublicName();

    if (!state->getBool(JSReadableState::reading)) {
        // stream.read(0)
        MarkedArgumentBuffer args;
        args.append(jsNumber(0));

        callRead(stream, jsCast<JSFunction*>(stream->get(lexicalGlobalObject, readIdentifier)), WTFMove(args), vm, lexicalGlobalObject, emitter);
    }

    state->setBool(JSReadableState::resumeScheduled, true);
    // stream.emit('resume')
    auto eventType = clientData->builtinNames().resumePublicName();
    MarkedArgumentBuffer args;

    emitter.emitForBindings(eventType, args);

    flow(lexicalGlobalObject, stream, state);

    if (state->m_flowing > 0 && !state->getBool(JSReadableState::reading)) {
        // stream.read(0)
        auto read = stream->get(lexicalGlobalObject, readIdentifier);
        auto callData = JSC::getCallData(read);
        if (callData.type == CallData::Type::None) {
            throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
            return JSValue::encode(jsUndefined());
        }
        MarkedArgumentBuffer args;
        args.append(jsNumber(0));
        callRead(stream, jsCast<JSFunction*>(read), WTFMove(args), vm, lexicalGlobalObject, emitter);
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

EncodedJSValue emitReadable_(JSGlobalObject* lexicalGlobalObject, JSObject* stream, JSReadableState* state)
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue errored = state->m_errored.get();

    if (!state->getBool(JSReadableState::destroyed) && !errored.toBoolean(lexicalGlobalObject) && (state->m_length || state->getBool(JSReadableState::ended))) {
        // stream.emit('readable')
        auto clientData = WebCore::clientData(vm);

        auto eventType = clientData->builtinNames().readablePublicName();
        MarkedArgumentBuffer args;
        auto* emitter
            = jsEventEmitterCastFast(vm, lexicalGlobalObject, stream);
        if (UNLIKELY(!emitter)) {
            throwTypeError(lexicalGlobalObject, throwScope, "Stream must be an EventEmitter"_s);
            return JSValue::encode(JSValue {});
        }
        emitter->wrapped().emitForBindings(eventType, args);

        state->setBool(JSReadableState::emittedReadable, false);
    }

    state->setBool(JSReadableState::needReadable, state->m_flowing <= 0 && !state->getBool(JSReadableState::ended) && state->m_length <= state->m_highWaterMark);
    flow(lexicalGlobalObject, stream, state);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_emitReadable_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        RELEASE_AND_RETURN(throwScope, emitReadable_(lexicalGlobalObject, stream, state));
}

#undef JSReadableHelper_EXTRACT_STREAM_STATE

} // namespace WebCore
