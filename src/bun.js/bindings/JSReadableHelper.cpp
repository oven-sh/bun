#include "JSReadableHelper.h"
#include "JSReadableState.h"
#include "JSBufferList.h"
#include "JSBuffer.h"
#include "JSEventEmitter.h"
#include "JavaScriptCore/Lookup.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "JSDOMAttribute.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {
using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsReadable_maybeReadMore_);
JSC_DEFINE_HOST_FUNCTION(jsReadable_maybeReadMore_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(lexicalGlobalObject, throwScope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSObject* stream = callFrame->uncheckedArgument(0).toObject(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
    JSReadableState* state = jsDynamicCast<JSReadableState*>(callFrame->uncheckedArgument(1));
    if (!state) {
        throwTypeError(lexicalGlobalObject, throwScope, "Second argument not ReadableState"_s);
        return JSValue::encode(jsUndefined());
    }

    auto read = stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));
    auto callData = JSC::getCallData(read);
    if (callData.type == CallData::Type::None) {
        throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
        return JSValue::encode(jsUndefined());
    }
    MarkedArgumentBuffer args;
    args.append(jsNumber(0));

    while (
        !state->m_reading &&
        !state->m_ended &&
        (state->m_length < state->m_highWaterMark || (state->m_flowing > 0 && state->m_length == 0))) {
        int64_t len = state->m_length;

        JSC::call(lexicalGlobalObject, read, callData, JSValue(stream), args);

        if (len == state->m_length)
            break;
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_maybeReadMore, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(lexicalGlobalObject, throwScope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue streamVal = callFrame->uncheckedArgument(0);
    JSValue stateVal = callFrame->uncheckedArgument(1);

    // make this static?
    JSFunction* maybeReadMore_ = JSC::JSFunction::create(
        vm, lexicalGlobalObject, 0, "maybeReadMore_"_s, jsReadable_maybeReadMore_, ImplementationVisibility::Public);

    lexicalGlobalObject->queueMicrotask(maybeReadMore_, streamVal, stateVal, JSValue{}, JSValue{});
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

void flow(JSGlobalObject* lexicalGlobalObject, JSObject* stream, JSReadableState* state)
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto read = stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));
    auto callData = JSC::getCallData(read);
    if (callData.type == CallData::Type::None) {
        throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
        return;
    }
    MarkedArgumentBuffer args;

    while (state->m_flowing > 0) {
        JSValue ret = JSC::call(lexicalGlobalObject, read, callData, JSValue(stream), args);
        if (ret.isNull())
            break;
    }
}

static JSC_DECLARE_HOST_FUNCTION(jsReadable_resume_);
JSC_DEFINE_HOST_FUNCTION(jsReadable_resume_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(lexicalGlobalObject, throwScope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSObject* stream = callFrame->uncheckedArgument(0).toObject(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
    JSReadableState* state = jsDynamicCast<JSReadableState*>(callFrame->uncheckedArgument(1));
    if (!state) {
        throwTypeError(lexicalGlobalObject, throwScope, "Second argument not ReadableState"_s);
        return JSValue::encode(jsUndefined());
    }

    if (!state->m_reading) {
        // stream.read(0)
        auto read = stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));
        auto callData = JSC::getCallData(read);
        if (callData.type == CallData::Type::None) {
            throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
            return JSValue::encode(jsUndefined());
        }
        MarkedArgumentBuffer args;
        args.append(jsNumber(0));
        JSC::call(lexicalGlobalObject, read, callData, JSValue(stream), args);
    }

    state->m_resumeScheduled = true;
    // stream.emit('resume')
    auto eventType = Identifier::fromString(vm, "resume"_s);
    MarkedArgumentBuffer args;
    auto emitter = jsDynamicCast<JSEventEmitter*>(stream);
    if (!emitter) {
        throwTypeError(lexicalGlobalObject, throwScope, "stream is not EventEmitter"_s);
        return JSValue::encode(jsUndefined());
    }
    emitter->wrapped().emitForBindings(eventType, args);

    flow(lexicalGlobalObject, stream, state);

    if (state->m_flowing && !state->m_reading) {
        // stream.read(0)
        auto read = stream->get(lexicalGlobalObject, Identifier::fromString(vm, "read"_s));
        auto callData = JSC::getCallData(read);
        if (callData.type == CallData::Type::None) {
            throwException(lexicalGlobalObject, throwScope, createNotAFunctionError(lexicalGlobalObject, read));
            return JSValue::encode(jsUndefined());
        }
        MarkedArgumentBuffer args;
        args.append(jsNumber(0));
        JSC::call(lexicalGlobalObject, read, callData, JSValue(stream), args);
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_resume, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(lexicalGlobalObject, throwScope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue streamVal = callFrame->uncheckedArgument(0);
    JSValue stateVal = callFrame->uncheckedArgument(1);

    JSReadableState* state = jsDynamicCast<JSReadableState*>(callFrame->uncheckedArgument(1));
    if (!state) {
        throwTypeError(lexicalGlobalObject, throwScope, "Second argument not ReadableState"_s);
        return JSValue::encode(jsUndefined());
    }

    if (!state->m_resumeScheduled) {
        state->m_resumeScheduled = true;
        // make this static?
        JSFunction* resume_ = JSC::JSFunction::create(
            vm, lexicalGlobalObject, 0, "resume_"_s, jsReadable_resume_, ImplementationVisibility::Public);

        lexicalGlobalObject->queueMicrotask(resume_, streamVal, stateVal, JSValue{}, JSValue{});
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsReadable_emitReadable_, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(lexicalGlobalObject, throwScope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSObject* stream = callFrame->uncheckedArgument(0).toObject(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
    JSReadableState* state = jsDynamicCast<JSReadableState*>(callFrame->uncheckedArgument(1));
    if (!state) {
        throwTypeError(lexicalGlobalObject, throwScope, "Second argument not ReadableState"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue errored = state->getDirect(vm, JSC::Identifier::fromString(vm, "errored"_s));
    if (!state->m_destroyed && !errored.toBoolean(lexicalGlobalObject) && (state->m_length || state->m_ended)) {
        // stream.emit('readable')
        auto eventType = Identifier::fromString(vm, "readable"_s);
        MarkedArgumentBuffer args;
        auto emitter = jsDynamicCast<JSEventEmitter*>(stream);
        if (!emitter) {
            throwTypeError(lexicalGlobalObject, throwScope, "stream is not EventEmitter"_s);
            return JSValue::encode(jsUndefined());
        }
        emitter->wrapped().emitForBindings(eventType, args);

        state->m_emittedReadable = false;
    }

    state->m_needReadable = state->m_flowing <= 0 && !state->m_ended && state->m_length <= state->m_highWaterMark;
    flow(lexicalGlobalObject, stream, state);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

} // namespace WebCore
