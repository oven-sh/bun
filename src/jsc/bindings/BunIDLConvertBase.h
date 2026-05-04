#pragma once
#include "BunIDLConvertContext.h"
#include "JSDOMConvertBase.h"
#include <concepts>
#include <optional>
#include <tuple>
#include <utility>

namespace Bun {

template<typename T, IDLConversionContext Ctx>
typename WebCore::Converter<T>::ReturnType convertIDL(
    JSC::JSGlobalObject& globalObject,
    JSC::JSValue value,
    Ctx& ctx)
{
    if constexpr (WebCore::Converter<T>::takesContext) {
        return WebCore::Converter<T>::convert(globalObject, value, ctx);
    } else {
        return WebCore::Converter<T>::convert(globalObject, value);
    }
}

template<typename T, IDLConversionContext Ctx>
std::optional<typename WebCore::Converter<T>::ReturnType> tryConvertIDL(
    JSC::JSGlobalObject& globalObject,
    JSC::JSValue value,
    Ctx& ctx)
{
    if constexpr (WebCore::Converter<T>::takesContext) {
        return WebCore::Converter<T>::tryConvert(globalObject, value, ctx);
    } else {
        return WebCore::Converter<T>::tryConvert(globalObject, value);
    }
}

template<typename IDL>
struct DefaultContextConverter : WebCore::DefaultConverter<IDL> {
    using typename WebCore::DefaultConverter<IDL>::ReturnType;

    static constexpr bool takesContext = true;

    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        auto ctx = DefaultConversionContext {};
        return WebCore::Converter<IDL>::convert(globalObject, value, ctx);
    }
};

template<typename IDL>
struct DefaultTryConverter : DefaultContextConverter<IDL> {
    using typename DefaultContextConverter<IDL>::ReturnType;

    template<IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto result = WebCore::Converter<IDL>::tryConvert(globalObject, value, ctx);
        RETURN_IF_EXCEPTION(scope, {});
        if (result.has_value()) {
            return std::move(*result);
        }
        WebCore::Converter<IDL>::throwConversionFailed(globalObject, scope, ctx);
        return ReturnType {};
    }

    static std::optional<ReturnType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value)
    {
        auto ctx = DefaultConversionContext {};
        return WebCore::Converter<IDL>::tryConvert(globalObject, value, ctx);
    }
};

}
