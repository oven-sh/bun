#include "JSConnectionsListPrototype.h"
#include "JSConnectionsList.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "uv.h"

namespace Bun {

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsConnectionsList_all);
JSC_DECLARE_HOST_FUNCTION(jsConnectionsList_idle);
JSC_DECLARE_HOST_FUNCTION(jsConnectionsList_active);
JSC_DECLARE_HOST_FUNCTION(jsConnectionsList_expired);

const ClassInfo JSConnectionsListPrototype::s_info = { "ConnectionsList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSConnectionsListPrototype) };

static const HashTableValue JSConnectionsListPrototypeTableValues[] = {
    { "all"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsConnectionsList_all, 0 } },
    { "idle"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsConnectionsList_idle, 0 } },
    { "active"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsConnectionsList_active, 0 } },
    { "expired"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsConnectionsList_expired, 2 } },
};

void JSConnectionsListPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSConnectionsListPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsConnectionsList_all, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSConnectionsList* connections = jsDynamicCast<JSConnectionsList*>(callFrame->thisValue());
    if (!connections) {
        return JSValue::encode(jsUndefined());
    }

    JSArray* result = connections->all(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsConnectionsList_idle, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSConnectionsList* connections = jsDynamicCast<JSConnectionsList*>(callFrame->thisValue());
    if (!connections) {
        return JSValue::encode(jsUndefined());
    }

    JSArray* result = connections->idle(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsConnectionsList_active, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSConnectionsList* connections = jsDynamicCast<JSConnectionsList*>(callFrame->thisValue());
    if (!connections) {
        return JSValue::encode(jsUndefined());
    }

    JSArray* result = connections->active(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsConnectionsList_expired, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSConnectionsList* connections = jsDynamicCast<JSConnectionsList*>(callFrame->thisValue());
    if (!connections) {
        return JSValue::encode(jsUndefined());
    }

    JSValue headersTimeoutValue = callFrame->argument(0);
    JSValue requestTimeoutValue = callFrame->argument(1);

    uint64_t headersTimeout = headersTimeoutValue.toUInt32(globalObject) * 1000000;
    RETURN_IF_EXCEPTION(scope, {});
    uint64_t requestTimeout = requestTimeoutValue.toUInt32(globalObject) * 1000000;
    RETURN_IF_EXCEPTION(scope, {});

    if (headersTimeout == 0 && requestTimeout == 0) {
        JSArray* result = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(result);
    } else if (requestTimeout > 0 && headersTimeout > requestTimeout) {
        std::swap(headersTimeout, requestTimeout);
    }

    const uint64_t now = uv_hrtime();

    const uint64_t headersDeadline = (headersTimeout > 0 && now > headersTimeout) ? now - headersTimeout : 0;
    const uint64_t requestDeadline = (requestTimeout > 0 && now > requestTimeout) ? now - requestTimeout : 0;

    if (headersDeadline == 0 && requestDeadline == 0) {
        JSArray* result = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(result);
    }

    JSArray* result = connections->expired(globalObject, headersDeadline, requestDeadline);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

} // namespace Bun
