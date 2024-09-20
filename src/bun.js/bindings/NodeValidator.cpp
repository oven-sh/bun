#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include <cmath>
#include <limits>

#include "ErrorCode.h"
#include "NodeValidator.h"

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateInteger, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto min = callFrame->argument(2);
    auto max = callFrame->argument(3);

    if (!value.isNumber()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    if (min.isUndefined()) min = jsNumber(-9007199254740991); // Number.MIN_SAFE_INTEGER
    if (max.isUndefined()) max = jsNumber(9007199254740991); // Number.MAX_SAFE_INTEGER

    auto value_num = value.asNumber();
    auto min_num = min.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto max_num = max.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    max_num = std::max(min_num, max_num);

    if (std::fmod(value_num, 1.0) != 0) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);
    if (value_num < min_num || value_num > max_num) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, max_num, value);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateNumber, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto min = callFrame->argument(2);
    auto max = callFrame->argument(3);
    return Bun::validateNumber(scope, globalObject, value, name, min, max);
}

JSC::EncodedJSValue validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue min, JSValue max)
{
    if (!value.isNumber()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);

    auto value_num = value.asNumber();
    auto min_num = min.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto max_num = max.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto min_isnonnull = !min.isUndefinedOrNull();
    auto max_isnonnull = !max.isUndefinedOrNull();

    if ((min_isnonnull && value_num < min_num) || (max_isnonnull && value_num > max_num) || ((min_isnonnull || max_isnonnull) && std::isnan(value_num))) {
        if (min_isnonnull && max_isnonnull) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, max_num, value);
        if (min_isnonnull) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, Bun::LOWER, value);
        if (max_isnonnull) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, max_num, Bun::UPPER, value);
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, ""_s, value);
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (!value.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "string"_s, value);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateFiniteNumber, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto number = callFrame->argument(0);
    auto name = callFrame->argument(1);
    return Bun::validateFiniteNumber(scope, globalObject, number, name);
}
JSC::EncodedJSValue validateFiniteNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue number, JSValue name)
{
    if (number.isUndefined()) {
        return JSValue::encode(jsBoolean(false));
    }
    if (number.isNumber() && (!std::isnan(number.asNumber())) && (!std::isinf(number.asNumber()))) {
        return JSValue::encode(jsBoolean(true));
    }
    if (number.isNumber() && std::isnan(number.asNumber())) {
        return JSValue::encode(jsBoolean(false));
    }

    Bun::validateNumber(scope, globalObject, number, name, jsUndefined(), jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});

    return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "a finite number"_s, number);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_checkRangesOrGetDefault, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto number = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto lower = callFrame->argument(2);
    auto upper = callFrame->argument(3);
    auto def = callFrame->argument(4);

    auto finite = Bun::validateFiniteNumber(scope, globalObject, number, name);
    RETURN_IF_EXCEPTION(scope, {});
    auto finite_real = JSValue::decode(finite).asBoolean();
    if (!finite_real) {
        return JSValue::encode(def);
    }

    auto number_num = number.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto lower_num = lower.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto upper_num = upper.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (number_num < lower_num || number_num > upper_num) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, lower_num, upper_num, number);
    }
    return JSValue::encode(number);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (JSC::getCallData(value).type == JSC::CallData::Type::None) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "Function"_s, value);
    }
    return JSValue::encode(jsUndefined());
}

}
