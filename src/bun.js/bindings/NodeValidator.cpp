#include "root.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ExceptionScope.h"
#include <cmath>
#include <limits>

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateInteger, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto min = callFrame->argument(2);
    auto max = callFrame->argument(3);

    if (!value.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    }
    if (min.isUndefined()) {
        min = jsNumber(-9007199254740991); // Number.MIN_SAFE_INTEGER
    }
    if (max.isUndefined()) {
        max = jsNumber(9007199254740991); // Number.MAX_SAFE_INTEGER
    }
    if (!min.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "min"_s, "number"_s, value);
    }
    if (!max.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "max"_s, "number"_s, value);
    }

    auto value_num = value.asNumber();
    auto min_num = min.asNumber();
    auto max_num = max.asNumber();
    max_num = std::max(min_num, max_num);

    double intpart;
    if (std::modf(value_num, &intpart) != 0) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);
    }
    if (value_num < min_num || value_num > max_num) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, max_num, value);
    }

    return JSValue::encode(jsUndefined());
}

//
//

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateBounds, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto min = callFrame->argument(2);
    auto buffer = callFrame->argument(3);
    auto width = callFrame->argument(4);

    if (!value.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    }

    auto byteLength = buffer.get(globalObject, Identifier::fromString(vm, "byteLength"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (!byteLength.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "byteLength"_s, "number"_s, byteLength);
    }

    auto byteOffset = buffer.get(globalObject, Identifier::fromString(vm, "byteOffset"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (!byteOffset.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "byteOffset"_s, "number"_s, byteOffset);
    }

    if (!min.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "min"_s, "number"_s, min);
    }
    if (!width.isNumber()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "width"_s, "number"_s, width);
    }

    auto value_num = value.asNumber();
    auto min_num = min.asNumber();
    auto width_num = width.asNumber();
    auto byteLength_num = byteLength.asNumber();
    auto byteOffset_num = byteOffset.asNumber();

    auto max_num = byteLength_num - byteOffset_num - width_num;
    max_num = std::max(min_num, max_num);

    if (std::isinf(value_num)) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, max_num, value);
    }
    double intpart;
    if (std::modf(value_num, &intpart) != 0) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);
    }
    if (byteOffset_num + value_num > byteLength_num || byteOffset_num + value_num + width_num - 1 > byteLength_num) {
        return Bun::ERR::BUFFER_OUT_OF_BOUNDS(scope, globalObject);
    }
    if (value_num < min_num || value_num > max_num) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, max_num, value);
    }

    return JSValue::encode(jsUndefined());
}
