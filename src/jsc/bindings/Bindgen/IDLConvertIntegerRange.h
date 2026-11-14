#pragma once
#include "root.h"
#include "Bindgen/IDLTypes.h"
#include "BunIDLConvertBase.h"
#include "NodeValidator.h"
#include <cmath>

namespace Bun::Bindgen {

// `.enforceRange(min, max)`: WebIDL's [EnforceRange], with a range of its own.
template<std::integral T, T Min, T Max>
struct IDLEnforceRange : WebCore::IDLType<T> {};

// `.validateInteger(min, max)`: Node's validateInteger, with its errors.
template<std::integral T, T Min, T Max>
struct IDLValidateInteger : WebCore::IDLType<T> {};

namespace Detail {

template<std::integral T, T Min, T Max>
ALWAYS_INLINE bool isInt32InRange(JSC::JSValue value)
{
    return value.isInt32() && value.asInt32() >= static_cast<int64_t>(Min) && value.asInt32() <= static_cast<int64_t>(Max);
}

// std::nullopt if it threw.
template<IDLConversionContext Ctx>
NEVER_INLINE std::optional<int64_t> enforceRange(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, int64_t min, int64_t max)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    double number = value.toNumber(&globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    double integer = std::trunc(number);
    if (integer >= static_cast<double>(min) && integer <= static_cast<double>(max))
        return static_cast<int64_t>(integer);
    ctx.throwTypeMustBe(globalObject, scope, WTF::makeString("in the range ["_s, min, ", "_s, max, "] (received "_s, number, ')'));
    return std::nullopt;
}

}

}

template<std::integral T, T Min, T Max>
struct WebCore::Converter<Bun::Bindgen::IDLEnforceRange<T, Min, Max>> : WebCore::DefaultConverter<Bun::Bindgen::IDLEnforceRange<T, Min, Max>> {
    // False if it threw. Inlined so that an int32 in range costs its tests and nothing else.
    template<Bun::IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, T& result)
    {
        if (Bun::Bindgen::Detail::isInt32InRange<T, Min, Max>(value)) [[likely]] {
            result = static_cast<T>(value.asInt32());
            return true;
        }
        auto converted = Bun::Bindgen::Detail::enforceRange(globalObject, value, ctx, Min, Max);
        if (!converted)
            return false;
        result = static_cast<T>(*converted);
        return true;
    }
};

template<std::integral T, T Min, T Max>
struct WebCore::Converter<Bun::Bindgen::IDLValidateInteger<T, Min, Max>> : WebCore::DefaultConverter<Bun::Bindgen::IDLValidateInteger<T, Min, Max>> {
    // False if it threw. Inlined so that an int32 in range costs its tests and nothing else.
    static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, WTF::ASCIILiteral name, T& result)
    {
        if (Bun::Bindgen::Detail::isInt32InRange<T, Min, Max>(value)) [[likely]] {
            result = static_cast<T>(value.asInt32());
            return true;
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
        using Validated = std::conditional_t<std::signed_integral<T>, int32_t, std::conditional_t<sizeof(T) <= sizeof(uint32_t), uint32_t, size_t>>;
        static_assert(sizeof(T) <= sizeof(Validated));
        Validated result = 0;
        Bun::V::validateInteger(scope, &globalObject, value, name, JSC::jsNumber(Min), JSC::jsNumber(Max), &result);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return static_cast<T>(result);
    }
};
