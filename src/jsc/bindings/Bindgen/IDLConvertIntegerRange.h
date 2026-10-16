#pragma once
#include "root.h"
#include "Bindgen/IDLTypes.h"
#include "ErrorCode.h"
#include "JSDOMConvertBase.h"
#include <JavaScriptCore/MathCommon.h>
#include <cmath>
#include <wtf/text/MakeString.h>

namespace Bun::Bindgen {

// `.enforceRange(min, max)`: WebIDL's [EnforceRange], with a range of its own.
template<std::integral T, T Min, T Max>
struct IDLEnforceRange : WebCore::IDLType<T> {};

// `.validateInteger(min, max)`: Node's validateInteger, with its errors.
template<std::integral T, T Min, T Max>
struct IDLValidateInteger : WebCore::IDLType<T> {};

}

template<std::integral T, T Min, T Max>
struct WebCore::Converter<Bun::Bindgen::IDLEnforceRange<T, Min, Max>> : WebCore::DefaultConverter<Bun::Bindgen::IDLEnforceRange<T, Min, Max>> {
    static T convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        double number = value.toNumber(&globalObject);
        RETURN_IF_EXCEPTION(scope, 0);
        if (std::isfinite(number)) {
            number = std::trunc(number);
            if (number >= Min && number <= Max)
                return static_cast<T>(number);
        }
        throwTypeError(&globalObject, scope, makeString("Value "_s, number, " is outside the range ["_s, static_cast<double>(Min), ", "_s, static_cast<double>(Max), ']'));
        return 0;
    }
};

template<std::integral T, T Min, T Max>
struct WebCore::Converter<Bun::Bindgen::IDLValidateInteger<T, Min, Max>> : WebCore::DefaultConverter<Bun::Bindgen::IDLValidateInteger<T, Min, Max>> {
    static T convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, WTF::ASCIILiteral name)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!value.isNumber()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, &globalObject, name, "number"_s, value);
            return 0;
        }
        double number = value.asNumber();
        if (!JSC::isInteger(number)) {
            Bun::ERR::OUT_OF_RANGE(scope, &globalObject, name, "an integer"_s, value);
            return 0;
        }
        if (number < Min || number > Max) {
            Bun::ERR::OUT_OF_RANGE(scope, &globalObject, name, Min, Max, value);
            return 0;
        }
        return static_cast<T>(number);
    }
};
