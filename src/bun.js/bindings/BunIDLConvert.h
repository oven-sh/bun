#pragma once
#include "BunIDLTypes.h"
#include "BunIDLConvertBase.h"
#include "BunIDLConvertNumbers.h"
#include "BunIDLHumanReadable.h"
#include "JSDOMConvert.h"
#include <JavaScriptCore/JSArray.h>
#include <tuple>
#include <utility>

template<> struct WebCore::Converter<Bun::IDLRawAny> : WebCore::DefaultConverter<Bun::IDLRawAny> {
    static JSC::JSValue convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        return value;
    }
};

template<> struct WebCore::Converter<Bun::IDLStrictNull>
    : Bun::DefaultTryConverter<Bun::IDLStrictNull> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<std::nullptr_t> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isUndefinedOrNull()) {
            return nullptr;
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotNull(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::IDLStrictUndefined>
    : Bun::DefaultTryConverter<Bun::IDLStrictUndefined> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<std::monostate> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isUndefined()) {
            return std::monostate {};
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotUndefined(globalObject, scope);
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::IDLLooseNullable<IDL>>
    : Bun::DefaultTryConverter<Bun::IDLLooseNullable<IDL>> {

    using ReturnType = WebCore::Converter<WebCore::IDLNullable<IDL>>::ReturnType;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<ReturnType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (!value.toBoolean(&globalObject))
            return IDL::nullValue();
        return Bun::tryConvertIDL<IDL>(globalObject, value, ctx);
    }

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (!value.toBoolean(&globalObject))
            return IDL::nullValue();
        return Bun::convertIDL<IDL>(globalObject, value, ctx);
    }
};

template<> struct WebCore::Converter<Bun::IDLStrictBoolean>
    : Bun::DefaultTryConverter<Bun::IDLStrictBoolean> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<bool> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isBoolean()) {
            return value.asBoolean();
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotBoolean(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::IDLStrictString>
    : Bun::DefaultTryConverter<Bun::IDLStrictString> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<WTF::String> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isString()) {
            return value.toWTFString(&globalObject);
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotString(globalObject, scope);
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::IDLArray<IDL>> : Bun::DefaultTryConverter<Bun::IDLArray<IDL>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<typename Bun::IDLArray<IDL>::ImplementationType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (JSC::isJSArray(value)) {
            return Bun::convert<typename Bun::IDLArray<IDL>::Base>(globalObject, value, ctx);
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.template throwNotArray<IDL>(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::IDLArrayBufferRef>
    : Bun::DefaultTryConverter<Bun::IDLArrayBufferRef> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<typename Bun::IDLArrayBufferRef::ImplementationType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        if (auto* jsBuffer = JSC::toUnsharedArrayBuffer(vm, value)) {
            return jsBuffer;
        }
        if (auto* jsView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
            return jsView->unsharedBuffer();
        }
        if (auto* jsDataView = JSC::jsDynamicCast<JSC::JSDataView*>(value)) {
            return jsDataView->unsharedBuffer();
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotBufferSource(globalObject, scope);
    }
};

template<typename... IDL>
struct WebCore::Converter<Bun::IDLOrderedUnion<IDL...>>
    : Bun::DefaultTryConverter<Bun::IDLOrderedUnion<IDL...>> {
private:
    using Base = Bun::DefaultTryConverter<Bun::IDLOrderedUnion<IDL...>>;

public:
    using typename Base::ReturnType;

    static constexpr bool conversionHasSideEffects
        = (WebCore::Converter<IDL>::conversionHasSideEffects || ...);

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        using Last = std::tuple_element_t<sizeof...(IDL) - 1, std::tuple<IDL...>>;
        if constexpr (requires {
                          WebCore::Converter<Last>::tryConvert(globalObject, value, ctx);
                      }) {
            return Base::convert(globalObject, value, ctx);
        } else {
            return convertWithInfallibleLast(
                globalObject,
                value,
                ctx,
                std::make_index_sequence<sizeof...(IDL)> {});
        }
    }

    template<Bun::IDLConversionContext Ctx>
    static std::optional<ReturnType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        std::optional<ReturnType> result;
        auto tryAlternative = [&]<typename T>() -> bool {
            auto alternativeResult = Bun::tryConvertIDL<T>(globalObject, value, ctx);
            RETURN_IF_EXCEPTION(scope, true);
            if (!alternativeResult.has_value()) {
                return false;
            }
            result = ReturnType { std::move(*alternativeResult) };
            return true;
        };
        (tryAlternative.template operator()<IDL>() || ...);
        return result;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.template throwNoMatchInUnion<IDL...>(globalObject, scope);
    }

private:
    template<Bun::IDLConversionContext Ctx, std::size_t... indices>
    static ReturnType convertWithInfallibleLast(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx,
        std::index_sequence<indices...>)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        std::optional<ReturnType> result;
        auto tryAlternative = [&]<std::size_t index>() -> bool {
            using T = std::tuple_element_t<index, std::tuple<IDL...>>;
            if constexpr (index == sizeof...(IDL) - 1) {
                auto alternativeResult = Bun::convertIDL<T>(globalObject, value, ctx);
                RETURN_IF_EXCEPTION(scope, true);
                result = ReturnType { std::move(alternativeResult) };
                return true;
            } else {
                auto alternativeResult = Bun::tryConvertIDL<T>(globalObject, value, ctx);
                RETURN_IF_EXCEPTION(scope, true);
                if (!alternativeResult.has_value()) {
                    return false;
                }
                result = ReturnType { std::move(*alternativeResult) };
                return true;
            }
        };
        bool done = (tryAlternative.template operator()<indices>() || ...);
        ASSERT(done);
        if (!result.has_value()) {
            // Exception
            return {};
        }
        return std::move(*result);
    }
};
