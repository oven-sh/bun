#include "JSHTTPParserPrototype.h"
#include "JSHTTPParser.h"
#include "JSConnectionsList.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_close);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_free);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_remove);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_execute);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_finish);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_initialize);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_pause);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_resume);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_consume);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_unconsume);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_getCurrentBuffer);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_duration);
JSC_DECLARE_HOST_FUNCTION(jsHTTPParser_headersCompleted);

const ClassInfo JSHTTPParserPrototype::s_info = { "HTTPParser"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHTTPParserPrototype) };

static const HashTableValue JSHTTPParserPrototypeTableValues[] = {
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_close, 0 } },
    { "free"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_free, 0 } },
    { "remove"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_remove, 0 } },
    { "execute"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_execute, 0 } },
    { "finish"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_finish, 0 } },
    { "initialize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_initialize, 0 } },
    { "pause"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_pause, 0 } },
    { "resume"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_resume, 0 } },
    { "consume"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_consume, 0 } },
    { "unconsume"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_unconsume, 0 } },
    { "getCurrentBuffer"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_getCurrentBuffer, 0 } },
    { "duration"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_duration, 0 } },
    { "headersCompleted"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHTTPParser_headersCompleted, 0 } },
};

void JSHTTPParserPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSHTTPParserPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_close, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // our HTTPParser is the js object itself
    parser->m_freed = true;

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_free, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!
    // parser->emitTraceEventDestroy();
    // parser->emitDestroy();

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_remove, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    if (JSCell* connectionsCell = parser->m_connectionsList.get()) {
        if (JSConnectionsList* connections = jsDynamicCast<JSConnectionsList*>(connectionsCell)) {
            connections->pop(globalObject, parser);
            connections->popActive(globalObject, parser);
        }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_execute, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_finish, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_initialize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSConnectionsList* connections = nullptr;
    uint64_t maxHttpHeaderSize = 0;
    uint32_t lenientFlags = kLenientNone;

    // TODO: TODO!
    (void)lenientFlags;

    JSValue maxHttpHeaderSizeValue = callFrame->argument(2);

    if (maxHttpHeaderSizeValue.isNumber()) {
        maxHttpHeaderSize = static_cast<uint64_t>(maxHttpHeaderSizeValue.asNumber());
    }
    if (maxHttpHeaderSize == 0) {
        // TODO: TODO!
        // maxHttpHeaderSize = ;
    }

    JSValue lenientFlagsValue = callFrame->argument(3);
    if (lenientFlagsValue.isInt32()) {
        lenientFlags = lenientFlagsValue.asInt32();
    }

    if (callFrame->argumentCount() > 4) {
        JSValue connectionsListValue = callFrame->argument(4);
        connections = jsDynamicCast<JSConnectionsList*>(connectionsListValue);
    }

    JSValue typeValue = callFrame->argument(0);

    int32_t type = static_cast<int32_t>(typeValue.asNumber());

    ASSERT(type == HTTP_REQUEST || type == HTTP_RESPONSE);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    if (connections) {
        parser->m_connectionsList.set(vm, parser, connections);
        parser->m_lastMessageStart = Bun::hrtime();

        connections->push(globalObject, parser);
        connections->pushActive(globalObject, parser);
    } else {
        parser->m_connectionsList.clear();
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_pause, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_resume, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_consume, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_unconsume, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_getCurrentBuffer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    JSUint8Array* buffer = JSUint8Array::createUninitialized(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), parser->currentBufferLen());
    RETURN_IF_EXCEPTION(scope, {});

    memcpy(buffer->vector(), parser->currentBufferData(), parser->currentBufferLen());

    return JSValue::encode(buffer);
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_duration, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    if (parser->lastMessageStart() == 0) {
        return JSValue::encode(jsNumber(0));
    }

    double duration = (Bun::hrtime() - parser->lastMessageStart()) / 1e6;

    return JSValue::encode(jsNumber(duration));
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_headersCompleted, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser || parser->freed()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(parser->headersCompleted()));
}

} // namespace Bun
