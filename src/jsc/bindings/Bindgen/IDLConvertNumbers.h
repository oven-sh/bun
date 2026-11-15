#pragma once
#include "Bindgen/IDLTypes.h"
#include "BunIDLConvertBase.h"
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/JSBigIntInlines.h>
#include <JavaScriptCore/MathCommon.h>
#include <limits>
#include <type_traits>
#include <utility>

namespace Bun::Bindgen::Detail {
template<std::signed_integral T>
std::optional<T> tryBigIntToInt(JSC::JSValue value)
{
    static constexpr int64_t minInt = std::numeric_limits<T>::min();
    static constexpr int64_t maxInt = std::numeric_limits<T>::max();
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
    static constexpr uint64_t minInt = 0;
    static constexpr uint64_t maxInt = std::numeric_limits<T>::max();
    using ComparisonResult = JSC::JSBigInt::ComparisonResult;
    if (JSC::JSBigInt::compare(value, minInt) != ComparisonResult::LessThan
        && JSC::JSBigInt::compare(value, maxInt) != ComparisonResult::GreaterThan) {
        return static_cast<T>(JSC::JSBigInt::toBigUInt64(value));
    }
    return std::nullopt;
}
}

template<std::integral T, Bun::Bindgen::AllowBigInt allowBigInt>
    requires(sizeof(T) <= sizeof(uint64_t))
struct WebCore::Converter<Bun::Bindgen::IDLStrictInteger<T, allowBigInt>>
    : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictInteger<T, allowBigInt>> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    ALWAYS_INLINE static std::optional<T> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isInt32() && std::in_range<T>(value.asInt32())) [[likely]]
            return static_cast<T>(value.asInt32());
        return tryConvertSlow(globalObject, value, ctx);
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotNumber(globalObject, scope);
    }

private:
    template<Bun::IDLConversionContext Ctx>
    NEVER_INLINE static std::optional<T> tryConvertSlow(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        static constexpr auto minInt = std::numeric_limits<T>::min();
        static constexpr auto maxInt = std::numeric_limits<T>::max();

        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (value.isInt32()) {
            ctx.throwIntegerOutOfRange(globalObject, scope, value.asInt32(), minInt, maxInt);
            return {};
        }

        if constexpr (allowBigInt == Bun::Bindgen::AllowBigInt::Yes) {
            using Largest = std::conditional_t<std::signed_integral<T>, int64_t, uint64_t>;
            if (value.isBigInt()) {
                if (auto result = Bun::Bindgen::Detail::tryBigIntToInt<T>(value))
                    return *result;
                if constexpr (maxInt < std::numeric_limits<Largest>::max()) {
                    if (auto result = Bun::Bindgen::Detail::tryBigIntToInt<Largest>(value)) {
                        ctx.throwIntegerOutOfRange(globalObject, scope, *result, minInt, maxInt);
                        return {};
                    }
                }
                ctx.throwBigIntOutOfRange(globalObject, scope, minInt, maxInt);
                return {};
            }
        }

        if (!value.isNumber())
            return std::nullopt;

        double number = value.asNumber();
        if (!JSC::isSafeInteger(number)) {
            ctx.throwNumberNotInteger(globalObject, scope, number);
            return {};
        }
        auto intVal = static_cast<int64_t>(number);
        if constexpr (maxInt >= JSC::maxSafeIntegerAsUInt64()) {
            if (std::signed_integral<T> || intVal >= 0)
                return static_cast<T>(intVal);
        } else if (intVal >= static_cast<int64_t>(minInt)
            && intVal <= static_cast<int64_t>(maxInt)) {
            return static_cast<T>(intVal);
        }
        ctx.throwIntegerOutOfRange(globalObject, scope, intVal, minInt, maxInt);
        return {};
    }
};

template<>
struct WebCore::Converter<Bun::Bindgen::IDLStrictDouble> : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictDouble> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<double> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isNumber())
            return value.asNumber();
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
struct WebCore::Converter<Bun::Bindgen::IDLStrictDoubleOrDate> : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictDoubleOrDate> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<double> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (value.isNumber())
            return value.asNumber();
        if (auto* date = dynamicDowncast<JSC::DateInstance>(value))
            return date->internalNumber();
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "a number or Date"_s);
    }
};

template<>
struct WebCore::Converter<Bun::Bindgen::IDLLooseDoubleOrBigInt>
    : Bun::DefaultContextConverter<Bun::Bindgen::IDLLooseDoubleOrBigInt> {

    template<Bun::IDLConversionContext Ctx>
    static double convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto numeric = value.toNumeric(&globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (numeric.isBigInt())
            numeric = JSC::JSBigInt::toNumber(numeric);
        return numeric.asNumber();
    }
};

template<std::integral T, Bun::Bindgen::AllowBigInt allowBigInt>
struct WebCore::Converter<Bun::Bindgen::IDLLooseInteger<T, allowBigInt>>
    : Bun::DefaultContextConverter<Bun::Bindgen::IDLLooseInteger<T, allowBigInt>> {

    template<Bun::IDLConversionContext Ctx>
    static T convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSValue numeric;
        if constexpr (allowBigInt == Bun::Bindgen::AllowBigInt::Yes)
            numeric = value.toNumeric(&globalObject);
        else
            numeric = JSC::jsNumber(value.toNumber(&globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        using Strict = Bun::Bindgen::IDLStrictInteger<T, allowBigInt>;
        RELEASE_AND_RETURN(scope, Bun::convertIDL<Strict>(globalObject, numeric, ctx));
    }
};
