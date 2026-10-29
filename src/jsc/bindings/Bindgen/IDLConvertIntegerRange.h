#pragma once
#include "root.h"
#include "Bindgen/IDLTypes.h"
#include "JSDOMConvertNumbers.h"
#include "NodeValidator.h"

namespace Bun::Bindgen {

// `.enforceRange(min, max)`: WebIDL's [EnforceRange], with a range of its own.
template<std::integral T, T Min, T Max>
struct IDLEnforceRange : WebCore::IDLInteger<T> {};

// `.validateInteger(min, max)`: Node's validateInteger, with its errors.
template<std::integral T, T Min, T Max>
struct IDLValidateInteger : WebCore::IDLInteger<T> {};

// `.validateIntegerRange(min, max)`: what is not a number, and a fraction, is ERR_INVALID_ARG_TYPE.
// `NaN` is the value of `.nanAs(value)`, if there is one.
template<std::integral T, T Min, T Max, T... NaN>
    requires(sizeof...(NaN) <= 1)
struct IDLValidateIntegerRange : WebCore::IDLInteger<T> {};

// Nothing if it threw.
std::optional<int64_t> validateIntegerRangeSlow(JSC::JSGlobalObject&, JSC::JSValue, WTF::ASCIILiteral name, int64_t min, int64_t max, std::optional<int64_t> nan);

}

template<std::integral T, T Min, T Max>
struct WebCore::Converter<Bun::Bindgen::IDLEnforceRange<T, Min, Max>> : WebCore::DefaultConverter<Bun::Bindgen::IDLEnforceRange<T, Min, Max>> {
    // False if it threw.
    static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, T& result)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        double number = value.toNumber(&globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        result = static_cast<T>(WebCore::enforceRange(globalObject, number, Min, Max));
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }
};

template<std::integral T, T Min, T Max>
struct WebCore::Converter<Bun::Bindgen::IDLValidateInteger<T, Min, Max>> : WebCore::DefaultConverter<Bun::Bindgen::IDLValidateInteger<T, Min, Max>> {
    // False if it threw. Inlined so that an int32 in range costs its tests and nothing else.
    static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, WTF::ASCIILiteral name, T& result)
    {
        if (value.isInt32()) [[likely]] {
            int64_t number = value.asInt32();
            if (number >= static_cast<int64_t>(Min) && number <= static_cast<int64_t>(Max)) [[likely]] {
                result = static_cast<T>(number);
                return true;
            }
        }
        auto converted = convertSlow(globalObject, value, name);
        if (!converted)
            return false;
        result = *converted;
        return true;
    }

private:
    // Does not take `result`, which can then live in registers.
    NEVER_INLINE static std::optional<T> convertSlow(JSC::JSGlobalObject& globalObject, JSC::JSValue value, WTF::ASCIILiteral name)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        // The widths it is instantiated for.
        using Validated = std::conditional_t<sizeof(T) <= sizeof(int32_t),
            std::conditional_t<std::signed_integral<T>, int32_t, uint32_t>,
            std::conditional_t<std::signed_integral<T>, ssize_t, size_t>>;
        static_assert(sizeof(T) <= sizeof(Validated));
        Validated result = 0;
        Bun::V::validateInteger(scope, &globalObject, value, name, JSC::jsNumber(Min), JSC::jsNumber(Max), &result);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return static_cast<T>(result);
    }
};

template<std::integral T, T Min, T Max, T... NaN>
struct WebCore::Converter<Bun::Bindgen::IDLValidateIntegerRange<T, Min, Max, NaN...>> : WebCore::DefaultConverter<Bun::Bindgen::IDLValidateIntegerRange<T, Min, Max, NaN...>> {
    // They are compared as doubles, which hold every integer up to 2^53.
    static_assert(std::cmp_greater_equal(Min, -(1LL << 53)) && std::cmp_less_equal(Max, 1LL << 53));

    // False if it threw.
    static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, WTF::ASCIILiteral name, T& result)
    {
        if (value.isInt32()) [[likely]] {
            int64_t number = value.asInt32();
            if (number >= static_cast<int64_t>(Min) && number <= static_cast<int64_t>(Max)) [[likely]] {
                result = static_cast<T>(number);
                return true;
            }
        }
        auto converted = Bun::Bindgen::validateIntegerRangeSlow(globalObject, value, name, Min, Max, { NaN... });
        if (!converted)
            return false;
        result = static_cast<T>(*converted);
        return true;
    }
};
