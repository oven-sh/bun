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
    JSValue ret = JSC::call(lexicalGlobalObject, read, callData, JSValue(stream), WTFMove(args), exceptionPtr);
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

static JSC_DECLARE_HOST_FUNCTION(jsReadable_maybeReadMore_);
JSC_DEFINE_HOST_FUNCTION(jsReadable_maybeReadMore_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        auto read
        = stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));
    auto callData = JSC::getCallData(read);
    if (callData.type == CallData::Type::None) {
        throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
        return JSValue::encode(jsUndefined());
    }

    auto& emitter = jsDynamicCast<JSEventEmitter*>(stream)->wrapped();

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

JSC_DEFINE_HOST_FUNCTION(jsReadable_maybeReadMore, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        // make this static?
        JSFunction* maybeReadMore_
        = JSC::JSFunction::create(vm, lexicalGlobalObject, 0, "maybeReadMore_"_s, jsReadable_maybeReadMore_, ImplementationVisibility::Public);

    lexicalGlobalObject->queueMicrotask(maybeReadMore_, JSValue(stream), JSValue(state), JSValue {}, JSValue {});
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

void flow(JSGlobalObject* lexicalGlobalObject, JSObject* streamObj, JSReadableState* state)
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto read = streamObj->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));

    auto callData = JSC::getCallData(read);
    if (callData.type == CallData::Type::None) {
        throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
        return;
    }

    while (state->m_flowing > 0) {

        if (!callRead(streamObj, jsCast<JSFunction*>(read), MarkedArgumentBuffer(), vm, lexicalGlobalObject, jsCast<JSEventEmitter*>(streamObj)->wrapped())) {
            break;
        }
    }
}

static JSC_DECLARE_HOST_FUNCTION(jsReadable_resume_);
JSC_DEFINE_HOST_FUNCTION(jsReadable_resume_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        auto* jsEmitterWrap
        = jsDynamicCast<JSEventEmitter*>(stream);

    if (!jsEmitterWrap) {
        throwTypeError(lexicalGlobalObject, throwScope, "stream is not EventEmitter"_s);
        return JSValue::encode(jsUndefined());
    }

    auto& emitter = jsEmitterWrap->wrapped();

    if (!state->getBool(JSReadableState::reading)) {
        // stream.read(0)
        MarkedArgumentBuffer args;
        args.append(jsNumber(0));

        callRead(stream, jsCast<JSFunction*>(stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s))), WTFMove(args), vm, lexicalGlobalObject, emitter);
    }

    state->setBool(JSReadableState::resumeScheduled, true);
    // stream.emit('resume')
    auto eventType = Identifier::fromString(vm, "resume"_s);
    MarkedArgumentBuffer args;

    emitter.emitForBindings(eventType, args);

    flow(lexicalGlobalObject, stream, state);

    if (state->m_flowing > 0 && !state->getBool(JSReadableState::reading)) {
        // stream.read(0)
        auto read = stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));
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

JSC_DEFINE_HOST_FUNCTION(jsReadable_resume, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        if (!state->getBool(JSReadableState::resumeScheduled))
    {
        state->setBool(JSReadableState::resumeScheduled, true);
        // make this static?
        JSFunction* resume_ = JSC::JSFunction::create(
            vm, lexicalGlobalObject, 0, "resume_"_s, jsReadable_resume_, ImplementationVisibility::Public);

        lexicalGlobalObject->queueMicrotask(resume_, JSValue(stream), JSValue(state), JSValue {}, JSValue {});
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
        auto eventType = Identifier::fromString(vm, "readable"_s);
        MarkedArgumentBuffer args;
        auto emitter = jsDynamicCast<JSEventEmitter*>(stream);
        if (!emitter) {
            throwTypeError(lexicalGlobalObject, throwScope, "stream is not EventEmitter"_s);
            return JSValue::encode(jsUndefined());
        }
        emitter->wrapped().emitForBindings(eventType, args);

        state->setBool(JSReadableState::emittedReadable, false);
    }

    state->setBool(JSReadableState::needReadable, state->m_flowing <= 0 && !state->getBool(JSReadableState::ended) && state->m_length <= state->m_highWaterMark);
    flow(lexicalGlobalObject, stream, state);
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsReadable_emitReadable_);
JSC_DEFINE_HOST_FUNCTION(jsReadable_emitReadable_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        emitReadable_(lexicalGlobalObject, stream, state);

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

EncodedJSValue emitReadable(JSGlobalObject* lexicalGlobalObject, JSObject* stream, JSReadableState* state)
{
    VM& vm = lexicalGlobalObject->vm();

    state->setBool(JSReadableState::needReadable, false);
    if (!state->getBool(JSReadableState::emittedReadable)) {
        state->setBool(JSReadableState::emittedReadable, true);
        // make this static?
        JSFunction* emitReadable_ = JSC::JSFunction::create(
            vm, lexicalGlobalObject, 0, "emitReadable_"_s, jsReadable_emitReadable_, ImplementationVisibility::Public);

        lexicalGlobalObject->queueMicrotask(emitReadable_, JSValue(stream), JSValue(state), JSValue {}, JSValue {});
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_emitReadable, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        RELEASE_AND_RETURN(throwScope, emitReadable(lexicalGlobalObject, stream, state));
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_onEofChunk, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSReadableHelper_EXTRACT_STREAM_STATE

        if (state->getBool(JSReadableState::ended))
            RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));

    auto decoder = jsDynamicCast<JSStringDecoder*>(state->m_decoder.get());
    if (decoder) {
        JSString* chunk = jsDynamicCast<JSString*>(decoder->end(vm, lexicalGlobalObject, nullptr, 0));
        if (chunk && chunk->length()) {
            auto buffer = jsDynamicCast<JSBufferList*>(state->m_buffer.get());
            if (!buffer) {
                throwTypeError(lexicalGlobalObject, throwScope, "Not buffer on stream"_s);
                return JSValue::encode(jsUndefined());
            }
            buffer->push(vm, JSValue(chunk));
            state->m_length += state->getBool(JSReadableState::objectMode) ? 1 : chunk->length();
        }
    }

    state->setBool(JSReadableState::ended, true);

    if (state->getBool(JSReadableState::sync)) {
        RELEASE_AND_RETURN(throwScope, emitReadable(lexicalGlobalObject, stream, state));
    } else {
        state->setBool(JSReadableState::needReadable, false);
        state->setBool(JSReadableState::emittedReadable, true);
        RELEASE_AND_RETURN(throwScope, emitReadable_(lexicalGlobalObject, stream, state));
    }
}

#undef JSReadableHelper_EXTRACT_STREAM_STATE

} // namespace WebCore
