#pragma once
#include "BunIDLTypes.h"
#include "BunIDLConvertBase.h"
#include <JavaScriptCore/JSBigInt.h>
#include <cmath>
#include <limits>
#include <type_traits>
#include <utility>

namespace Bun::Detail {
template<std::signed_integral T>
std::optional<T> tryBigIntToInt(JSC::JSValue value)
{
    static constexpr std::int64_t minInt = std::numeric_limits<T>::min();
    static constexpr std::int64_t maxInt = std::numeric_limits<T>::max();
    using ComparisonResult = JSC::JSBigInt::ComparisonResult;
    if (JSC::JSBigInt::compare(value, minInt) != ComparisonResult::LessThan
        && JSC::JSBigInt::compare(value, maxInt) != ComparisonResult::GreaterThan) {
        return static_cast<T>(JSC::JSBigInt::toBigInt64(value));
    }
    return std::nullopt;
}

template<std::unsigned_integral T>
std::optional<T> tryBigIntToInt(JSC::JSValue value)
{
    static constexpr std::uint64_t minInt = 0;
    static constexpr std::uint64_t maxInt = std::numeric_limits<T>::max();
    using ComparisonResult = JSC::JSBigInt::ComparisonResult;
    if (JSC::JSBigInt::compare(value, minInt) != ComparisonResult::LessThan
        && JSC::JSBigInt::compare(value, maxInt) != ComparisonResult::GreaterThan) {
        return static_cast<T>(JSC::JSBigInt::toBigUInt64(value));
    }
    return std::nullopt;
}
}

template<std::integral T>
    requires(sizeof(T) <= sizeof(std::uint64_t))
struct WebCore::Converter<Bun::IDLStrictInteger<T>>
    : Bun::DefaultTryConverter<Bun::IDLStrictInteger<T>> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<T> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        static constexpr auto minInt = std::numeric_limits<T>::min();
        static constexpr auto maxInt = std::numeric_limits<T>::max();
        static constexpr auto maxSafeInteger = 9007199254740991LL;

        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (value.isInt32()) {
            auto intValue = value.asInt32();
            if (intValue >= minInt && intValue <= maxInt) {
                return intValue;
            }
            ctx.throwIntegerOutOfRange(globalObject, scope, intValue, minInt, maxInt);
            return {};
        }

        using Largest = std::conditional_t<std::signed_integral<T>, std::int64_t, std::uint64_t>;
        if (value.isBigInt()) {
            if (auto result = Bun::Detail::tryBigIntToInt<T>(value)) {
                return *result;
            }
            if constexpr (maxInt < std::numeric_limits<Largest>::max()) {
                if (auto result = Bun::Detail::tryBigIntToInt<Largest>(value)) {
                    ctx.throwIntegerOutOfRange(globalObject, scope, *result, minInt, maxInt);
                }
            }
            ctx.throwBigIntOutOfRange(globalObject, scope, minInt, maxInt);
            return {};
        }

        if (!value.isNumber()) {
            return std::nullopt;
        }

        double number = value.asNumber();
        if (number > maxSafeInteger || number < -maxSafeInteger) {
            ctx.throwNumberNotInteger(globalObject, scope, number);
            return {};
        }
        auto intVal = static_cast<std::int64_t>(number);
        if (intVal != number) {
            ctx.throwNumberNotInteger(globalObject, scope, number);
            return {};
        }
        if constexpr (maxInt >= static_cast<std::uint64_t>(maxSafeInteger)) {
            if (std::signed_integral<T> || intVal >= 0) {
                return static_cast<T>(intVal);
            }
        } else if (intVal >= static_cast<std::int64_t>(minInt)
            && intVal <= static_cast<std::int64_t>(maxInt)) {
            return static_cast<T>(intVal);
        }
        ctx.throwIntegerOutOfRange(globalObject, scope, intVal, minInt, maxInt);
        return {};
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotNumber(globalObject, scope);
    }
};

template<>
struct WebCore::Converter<Bun::IDLStrictDouble> : Bun::DefaultTryConverter<Bun::IDLStrictDouble> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<double> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isNumber()) {
            return value.asNumber();
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotNumber(globalObject, scope);
    }
};

template<>
struct WebCore::Converter<Bun::IDLFiniteDouble> : Bun::DefaultTryConverter<Bun::IDLFiniteDouble> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<double> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!value.isNumber()) {
            return std::nullopt;
        }
        double number = value.asNumber();
        if (std::isnan(number) || std::isinf(number)) {
            ctx.throwNumberNotFinite(globalObject, scope, number);
            return std::nullopt;
        }
        return number;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotNumber(globalObject, scope);
    }
};

template<std::integral T>
struct WebCore::Converter<Bun::IDLLooseInteger<T>>
    : Bun::DefaultContextConverter<Bun::IDLLooseInteger<T>> {

    template<Bun::IDLConversionContext Ctx>
    static T convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto numeric = value.toNumeric(&globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(
            scope,
            Bun::convertIDL<Bun::IDLStrictInteger<T>>(globalObject, numeric, ctx));
    }
};
