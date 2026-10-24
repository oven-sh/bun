#pragma once

// The bodies of the native functions of src/js/internal/validators.ts, which src/runtime/node/node_validators.bind.ts declares.

#include "root.h"

#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/TypedArrayType.h"
#include <cmath>
#include <limits>
#include <optional>

#include "Bindgen/IDLConvert.h"
#include "ErrorCode.h"
#include "JSAbortSignal.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"

namespace Bun::NodeValidators {

using namespace JSC;

// The bound, unless finding it out takes a conversion.
ALWAYS_INLINE std::optional<double> boundOr(JSValue bound, double otherwise)
{
    if (bound.isUndefined())
        return otherwise;
    if (bound.isNumber())
        return bound.asNumber();
    return std::nullopt;
}

// Between bounds that are finite.
ALWAYS_INLINE bool isIntegerBetween(double value, double min, double max)
{
    return std::trunc(value) == value && value >= min && value <= max;
}

// A number that passes without a conversion is answered in front of the code that words the errors.
ALWAYS_INLINE bool isIntegerThatPasses(double value, JSValue min, JSValue max)
{
    auto lowest = boundOr(min, JSC::minSafeInteger());
    auto highest = boundOr(max, JSC::maxSafeInteger());
    return lowest && highest && isIntegerBetween(value, *lowest, std::max(*lowest, *highest)) && std::isfinite(value);
}

ALWAYS_INLINE bool isInt32ThatPasses(double value, JSValue min, JSValue max)
{
    if (min.isUndefined() && max.isUndefined())
        return isIntegerBetween(value, std::numeric_limits<int32_t>::min(), std::numeric_limits<int32_t>::max());
    auto lowest = boundOr(min, std::numeric_limits<int32_t>::min());
    auto highest = boundOr(max, std::numeric_limits<int32_t>::max());
    return lowest && highest && isIntegerBetween(value, *lowest, *highest) && std::isfinite(value);
}

ALWAYS_INLINE bool isUint32ThatPasses(double value, JSValue positive)
{
    return isIntegerBetween(value, positive.isUndefined() || positive.isFalse() ? 0 : 1, std::numeric_limits<uint32_t>::max());
}

// NaN is inside no range, and any number passes where there is none.
ALWAYS_INLINE bool isNumberThatPasses(double value, JSValue min, JSValue max)
{
    return (min.isUndefinedOrNull() || (min.isNumber() && value >= min.asNumber())) && (max.isUndefinedOrNull() || (max.isNumber() && value <= max.asNumber()));
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateInteger(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    JSValue value = arguments.at(0);
    JSValue min = arguments.at(2);
    JSValue max = arguments.at(3);
    if (value.isNumber() && isIntegerThatPasses(value.asNumber(), min, max))
        return JSValue::encode(jsUndefined());

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ssize_t unused;
    return Bun::V::validateInteger(scope, globalObject, value, arguments.at(1), min, max, &unused);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateNumber(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    JSValue value = arguments.at(0);
    JSValue min = arguments.at(2);
    JSValue max = arguments.at(3);
    if (value.isNumber() && isNumberThatPasses(value.asNumber(), min, max))
        return JSValue::encode(jsUndefined());

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::V::validateNumber(scope, globalObject, value, arguments.at(1), min, max);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateFiniteNumber(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue number = arguments.at(0);
    if (number.isUndefined())
        return JSValue::encode(jsBoolean(false));
    if (number.isNumber() && !std::isinf(number.asNumber()))
        return JSValue::encode(jsBoolean(!std::isnan(number.asNumber())));

    JSValue name = arguments.at(1);
    return Bun::V::validateFiniteNumber(scope, globalObject, number, name);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue checkRangesOrGetDefault(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue number = arguments.at(0);
    JSValue name = arguments.at(1);
    JSValue lower = arguments.at(2);
    JSValue upper = arguments.at(3);

    if (number.isUndefined())
        return JSValue::encode(arguments.at(4));
    if (number.isNumber() && lower.isNumber() && upper.isNumber()) {
        double value = number.asNumber();
        if (value >= lower.asNumber() && value <= upper.asNumber() && std::isfinite(value))
            return JSValue::encode(number);
    }

    auto finite = Bun::V::validateFiniteNumber(scope, globalObject, number, name);
    RETURN_IF_EXCEPTION(scope, {});
    auto finite_real = JSValue::decode(finite).asBoolean();
    if (!finite_real)
        return JSValue::encode(arguments.at(4));

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

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validatePort(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue port = arguments.at(0);
    JSValue name = arguments.at(1);
    JSValue allowZero = arguments.at(2);

    if (port.isInt32() && port.asInt32() <= 0xffff && port.asInt32() >= (allowZero.isUndefined() || allowZero.isTrue() ? 0 : 1))
        return JSValue::encode(port);

    if (name.isUndefined()) name = jsString(vm, String("Port"_s));
    if (allowZero.isUndefined()) allowZero = jsBoolean(true);

    auto allowZero_b = allowZero.toBoolean(globalObject);
    if (!port.isNumber() && !port.isString()) return Bun::ERR::SOCKET_BAD_PORT(scope, globalObject, name, port, allowZero_b);

    if (port.isString()) {
        auto port_str = port.getString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto trimmed = port_str.trim([](auto c) {
            // White space is the union of *WhiteSpace* and *LineTerminator*: https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.trim

            // WhiteSpace ::
            if (c == 0x0009) return true; //     <TAB>
            if (c == 0x000B) return true; //     <VT>
            if (c == 0x000C) return true; //     <FF>
            if (c == 0xFEFF) return true; //     <ZWNBSP>
            // <USP>: any code point in general category “Space_Separator”, as of Unicode 16.0.0.
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

    return JSValue::encode(jsNumber(static_cast<int32_t>(port_num)));
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateAbortSignal(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue signal = arguments.at(0);
    JSValue name = arguments.at(1);

    if (!signal.isUndefined()) {
        auto* object = signal.getObject();
        if (!object) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "AbortSignal"_s, signal);
        if (object->inherits<WebCore::JSAbortSignal>()) {
            return JSValue::encode(jsUndefined());
        }

        auto propin = object->hasProperty(globalObject, Identifier::fromString(vm, "aborted"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!propin) return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "AbortSignal"_s, signal);
    }

    return JSValue::encode(jsUndefined());
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateArray(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = arguments.at(0);
    JSValue name = arguments.at(1);
    JSValue minLength = arguments.at(2);
    // No array is shorter than nothing.
    if (minLength.isUndefined() && isJSArray(value))
        return JSValue::encode(jsUndefined());
    return V::validateArray(scope, globalObject, value, name, minLength);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateInt32(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    JSValue value = arguments.at(0);
    JSValue min = arguments.at(2);
    JSValue max = arguments.at(3);
    if (value.isInt32() && min.isUndefined() && max.isUndefined())
        return JSValue::encode(jsUndefined());
    if (value.isNumber() && isInt32ThatPasses(value.asNumber(), min, max))
        return JSValue::encode(jsUndefined());

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return V::validateInt32(scope, globalObject, value, arguments.at(1), min, max);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateUint32(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    JSValue value = arguments.at(0);
    JSValue positive = arguments.at(2);
    if (value.isNumber() && isUint32ThatPasses(value.asNumber(), positive))
        return JSValue::encode(jsUndefined());

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return V::validateUint32(scope, globalObject, value, arguments.at(1), positive);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateEncoding(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue encoding = arguments.at(1);

    auto normalized = WebCore::parseEnumeration<BufferEncodingType>(*globalObject, encoding);
    RETURN_IF_EXCEPTION(scope, {});
    if (normalized == BufferEncodingType::hex) {
        JSValue data = arguments.at(0);

        size_t length = 0;
        if (data.isString()) {
            length = asString(data)->length();
        } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(data)) {
            length = view->length();
        } else if (auto* buffer = dynamicDowncast<JSC::JSArrayBuffer>(data)) {
            if (auto* impl = buffer->impl()) {
                length = impl->byteLength();
            }
        } else if (auto* object = data.getObject()) {
            JSValue lengthValue = object->get(globalObject, vm.propertyNames->length);
            RETURN_IF_EXCEPTION(scope, {});
            length = lengthValue.toLength(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (length % 2 != 0) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encoding, makeString("is invalid for data of length "_s, length));
        }
    }

    return JSValue::encode(jsUndefined());
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateBuffer(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue buffer = arguments.at(0);
    JSValue name = arguments.at(1);

    if (!buffer.isUndefined()) {
        if (!buffer.isCell() || JSC::typedArrayType(buffer.asCell()->type()) == NotTypedArray) {
            auto nameStr = name.isUndefined() ? String("buffer"_s) : name.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            return Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, nameStr, "Buffer, TypedArray, or DataView"_s, buffer);
        }
    }
    return JSValue::encode(jsUndefined());
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateOneOf(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = arguments.at(0);

    JSValue arrayValue = arguments.at(2);

    if (JSArray* array = dynamicDowncast<JSArray>(arrayValue)) {
        unsigned length = array->length();
        for (size_t i = 0; i < length; i++) {
            JSValue element = array->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            if (element == value)
                return JSValue::encode(jsUndefined());
            auto same = JSC::sameValue(globalObject, value, element);
            RETURN_IF_EXCEPTION(scope, {});
            if (same) {
                return JSValue::encode(jsUndefined());
            }
        }

        JSValue name = arguments.at(1);

        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, name, value, "must be one of: "_s, array);
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "values"_s, "Array"_s, arrayValue);
}

template<typename Arguments> ALWAYS_INLINE JSC::EncodedJSValue validateObject(JSC::JSGlobalObject* globalObject, const Arguments& arguments)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = arguments.at(0);
    // What an object literal or a class of a program makes is no function, no array and no proxy of one.
    if (value.isCell() && (value.asCell()->type() == FinalObjectType || value.asCell()->type() == CompiledObjectType))
        return JSValue::encode(jsUndefined());

    JSValue givenOptions = arguments.at(2);
    int32_t options = givenOptions.isInt32() ? givenOptions.asInt32() : 0;
    constexpr int32_t kValidateObjectAllowNullable = 1 << 0;
    constexpr int32_t kValidateObjectAllowArray = 1 << 1;
    constexpr int32_t kValidateObjectAllowFunction = 1 << 2;

    if ((options & kValidateObjectAllowArray) && isJSArray(value))
        return JSValue::encode(jsUndefined());
    if (value.isNull()) {
        if (options & kValidateObjectAllowNullable)
            return JSValue::encode(jsUndefined());
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, arguments.at(1), "object"_s, value);
    }
    if (value.isCallable()) {
        if (options & kValidateObjectAllowFunction)
            return JSValue::encode(jsUndefined());
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, arguments.at(1), "object"_s, value);
    }
    if (!(options & kValidateObjectAllowArray)) {
        bool isArray = JSC::isArray(globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        if (isArray)
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, arguments.at(1), "object"_s, value);
    }
    if (!value.isObject()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, arguments.at(1), "object"_s, value);
    }

    return JSValue::encode(jsUndefined());
}

} // namespace Bun::NodeValidators
