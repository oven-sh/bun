#include "JSHTTPParserPrototype.h"
#include "JSHTTPParser.h"
#include "JSConnectionsList.h"
#include "ZigGlobalObject.h"
#include "JSDOMExceptionHandling.h"

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
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "close"_s);
        return {};
    }

    parser->freeImpl();

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_free, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "free"_s);
        return {};
    }

    if (!parser->impl()) {
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

    JSValue thisValue = callFrame->thisValue();

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(thisValue);
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "remove"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(parser->impl()->remove(globalObject, parser));
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_execute, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "execute"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    JSValue bufferValue = callFrame->argument(0);

    if (auto* buffer = jsDynamicCast<JSArrayBufferView*>(bufferValue)) {
        if (buffer->isDetached()) {
            throwTypeError(globalObject, scope, "Buffer is detached"_s);
            return JSValue::encode(jsUndefined());
        }

        JSValue result = parser->impl()->execute(globalObject, reinterpret_cast<const char*>(buffer->vector()), buffer->byteLength());
        RETURN_IF_EXCEPTION(scope, {});

        if (!result.isEmpty()) {
            return JSValue::encode(result);
        }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_finish, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "finish"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    JSValue result = parser->impl()->execute(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});

    if (!result.isEmpty()) {
        return JSValue::encode(result);
    }

    return JSValue::encode(jsUndefined());
}

extern "C" size_t BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_initialize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint64_t maxHttpHeaderSize = 0;
    uint32_t lenientFlags = kLenientNone;
    JSConnectionsList* connections = nullptr;

    JSValue thisValue = callFrame->thisValue();
    JSValue typeValue = callFrame->argument(0);
    JSValue maxHttpHeaderSizeValue = callFrame->argument(2);
    JSValue lenientFlagsValue = callFrame->argument(3);
    JSValue connectionsListValue = callFrame->argument(4);

    if (callFrame->argumentCount() > 2) {
        if (maxHttpHeaderSizeValue.isNumber()) {
            maxHttpHeaderSize = static_cast<uint64_t>(maxHttpHeaderSizeValue.asNumber());
        }
    }

    if (maxHttpHeaderSize == 0) {
        maxHttpHeaderSize = BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;
    }

    if (callFrame->argumentCount() > 3) {
        if (lenientFlagsValue.isInt32()) {
            lenientFlags = lenientFlagsValue.asInt32();
        }
    }

    if (callFrame->argumentCount() > 4) {
        if (!connectionsListValue.isUndefinedOrNull()) {
            connections = jsDynamicCast<JSConnectionsList*>(connectionsListValue);
            if (!connections) {
                return JSValue::encode(jsUndefined());
            }
        }
    }

    llhttp_type_t type = static_cast<llhttp_type_t>(typeValue.toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(thisValue);
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "initialize"_s);
        return {};
    }
    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(parser->impl()->initialize(globalObject, parser, type, maxHttpHeaderSize, lenientFlags, connections));
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_pause, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "pause"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(parser->impl()->pause());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_resume, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "resume"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(parser->impl()->resume());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_consume, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "consume"_s);
        return {};
    }

    if (!parser->impl()) {
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
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "unconsume"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    // TODO: TODO!

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_getCurrentBuffer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*lexicalGlobalObject, scope, "HTTPParser"_s, "getCurrentBuffer"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(parser->impl()->getCurrentBuffer(lexicalGlobalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_duration, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "duration"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(parser->impl()->duration());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPParser_headersCompleted, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHTTPParser* parser = jsDynamicCast<JSHTTPParser*>(callFrame->thisValue());
    if (!parser) {
        throwThisTypeError(*globalObject, scope, "HTTPParser"_s, "headersCompleted"_s);
        return {};
    }

    if (!parser->impl()) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(parser->impl()->headersCompleted()));
}

} // namespace Bun
