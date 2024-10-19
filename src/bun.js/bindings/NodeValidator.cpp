#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/TypedArrayType.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include <cmath>
#include <limits>

#include "JSBufferEncodingType.h"
#include "BunProcess.h"
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
    return Bun::V::validateInteger(scope, globalObject, value, name, min, max);
}
JSC::EncodedJSValue V::validateInteger(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, JSC::JSValue min, JSC::JSValue max)
{
    if (!value.isNumber()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    if (min.isUndefined()) min = jsDoubleNumber(JSC::minSafeInteger());
    if (max.isUndefined()) max = jsDoubleNumber(JSC::maxSafeInteger());

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
    return Bun::V::validateNumber(scope, globalObject, value, name, min, max);
}
JSC::EncodedJSValue V::validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue min, JSValue max)
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
    return V::validateString(scope, globalObject, value, name);
}
JSC::EncodedJSValue V::validateString(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name)
{
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
    return Bun::V::validateFiniteNumber(scope, globalObject, number, name);
}
JSC::EncodedJSValue V::validateFiniteNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue number, JSValue name)
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

    Bun::V::validateNumber(scope, globalObject, number, name, jsUndefined(), jsUndefined());
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

    auto finite = Bun::V::validateFiniteNumber(scope, globalObject, number, name);
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
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "function"_s, value);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateBoolean, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (!value.isBoolean()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "boolean"_s, value);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validatePort, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto port = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto allowZero = callFrame->argument(2);

    if (name.isUndefined()) name = jsString(vm, String("Port"_s));
    if (allowZero.isUndefined()) allowZero = jsBoolean(true);

    auto allowZero_b = allowZero.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!port.isNumber() && !port.isString()) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);

    if (port.isString()) {
        auto port_str = port.getString(globalObject);
        auto trimmed = port_str.trim([](auto c) {
            // https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.trim
            // The definition of white space is the union of *WhiteSpace* and *LineTerminator*.

            // WhiteSpace ::
            if (c == 0x0009) return true; //     <TAB>
            if (c == 0x000B) return true; //     <VT>
            if (c == 0x000C) return true; //     <FF>
            if (c == 0xFEFF) return true; //     <ZWNBSP>
            //     <USP>
            // any code point in general category “Space_Separator”
            // ranges accurate as of unicode 16.0.0
            if (c >= 0x0009 && c <= 0x000D) return true;
            if (c >= 0x0020 && c <= 0x0020) return true;
            if (c >= 0x0085 && c <= 0x0085) return true;
            if (c >= 0x00A0 && c <= 0x00A0) return true;
            if (c >= 0x1680 && c <= 0x1680) return true;
            if (c >= 0x2000 && c <= 0x200A) return true;
            if (c >= 0x2028 && c <= 0x2028) return true;
            if (c >= 0x2029 && c <= 0x2029) return true;
            if (c >= 0x202F && c <= 0x202F) return true;
            if (c >= 0x205F && c <= 0x205F) return true;

            // LineTerminator ::
            if (c == 0x000A) return true; // <LF>
            if (c == 0x000D) return true; // <CR>
            if (c == 0x2028) return true; // <LS>
            if (c == 0x2029) return true; // <PS>

            return false;
        });
        if (trimmed.length() == 0) {
            return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);
        }
    }

    auto port_num = port.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (std::isnan(port_num)) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);
    if (std::isinf(port_num)) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);
    if (std::fmod(port_num, 1.0) != 0) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);
    if (port_num < 0) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);
    if (port_num > 0xffff) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);
    if (port_num == 0 && !allowZero_b) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);

    return JSValue::encode(port);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateAbortSignal, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto signal = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (!signal.isUndefined()) {
        if (signal.isNull()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "AbortSignal"_s, signal);
        if (!signal.isObject()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "AbortSignal"_s, signal);

        auto propin = signal.getObject()->hasProperty(globalObject, Identifier::fromString(vm, "aborted"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!propin) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "AbortSignal"_s, signal);
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateArray, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto minLength = callFrame->argument(2);

    if (minLength.isUndefined()) minLength = jsNumber(0);

    if (!JSC::isArray(globalObject, value)) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "Array"_s, value);

    auto length = value.get(globalObject, Identifier::fromString(vm, "length"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto length_num = length.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto minLength_num = minLength.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (length_num < minLength_num) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, name, value, makeString("must be longer than "_s, minLength_num));
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateInt32, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto min = callFrame->argument(2);
    auto max = callFrame->argument(3);

    if (!value.isNumber()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    if (min.isUndefined()) min = jsNumber(std::numeric_limits<int32_t>().min());
    if (max.isUndefined()) max = jsNumber(std::numeric_limits<int32_t>().max());

    auto value_num = value.asNumber();
    auto min_num = min.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto max_num = max.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (std::fmod(value_num, 1.0) != 0) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);
    if (value_num < min_num || value_num > max_num) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min_num, max_num, value);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateUint32, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);
    auto positive = callFrame->argument(2);

    if (!value.isNumber()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    if (positive.isUndefined()) positive = jsBoolean(false);

    auto value_num = value.asNumber();
    if (std::fmod(value_num, 1.0) != 0) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);

    auto positive_b = positive.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto min = positive_b ? 1 : 0;
    auto max = std::numeric_limits<uint32_t>().max();
    if (value_num < min || value_num > max) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min, max, value);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateSignalName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto signal = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (name.isUndefined()) name = jsString(vm, String("signal"_s));

    V::validateString(scope, globalObject, signal, name);
    RETURN_IF_EXCEPTION(scope, {});

    auto signal_str = signal.getString(globalObject);
    if (isSignalName(signal_str)) return JSValue::encode(jsUndefined());

    auto signal_upper = signal_str.convertToUppercaseWithoutLocale();
    RETURN_IF_EXCEPTION(scope, {});
    if (isSignalName(signal_str)) return Bun::ERR::UNKNOWN_SIGNAL(scope, globalObject, signal, true);
    return Bun::ERR::UNKNOWN_SIGNAL(scope, globalObject, signal);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateEncoding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto data = callFrame->argument(0);
    auto encoding = callFrame->argument(1);

    auto normalized = WebCore::parseEnumeration<BufferEncodingType>(*globalObject, encoding);
    // no check to throw ERR_UNKNOWN_ENCODING ? it's not in node but feels like it would be apt here

    auto length = data.get(globalObject, Identifier::fromString(vm, "length"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto length_num = length.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (normalized == BufferEncodingType::hex && std::fmod(length_num, 2.0) != 0) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encoding, makeString("is invalid for data of length "_s, length_num));
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validatePlainFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (!value.isCallable()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "function"_s, value);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateUndefined, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (!value.isUndefined()) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "undefined"_s, value);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto buffer = callFrame->argument(0);
    auto name = callFrame->argument(1);

    if (!buffer.isCell()) return JSValue::encode(jsUndefined());
    auto ty = buffer.asCell()->type();

    if (JSC::typedArrayType(ty) == NotTypedArray) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "Buffer, TypedArray, or DataView"_s, buffer);
    }
    return JSValue::encode(jsUndefined());
}

}
