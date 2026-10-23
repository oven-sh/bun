#pragma once
#include "BunIDLConvertContext.h"
#include "JSDOMConvertBase.h"
#include <concepts>
#include <optional>
#include <utility>

namespace Bun {

template<typename T, IDLConversionContext Ctx>
ALWAYS_INLINE typename WebCore::Converter<T>::ReturnType convertIDL(
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
ALWAYS_INLINE std::optional<typename WebCore::Converter<T>::ReturnType> tryConvertIDL(
    JSC::JSGlobalObject& globalObject,
    JSC::JSValue value,
    Ctx& ctx)
{
    return WebCore::Converter<T>::tryConvert(globalObject, value, ctx);
}

template<typename IDL>
struct DefaultContextConverter : WebCore::DefaultConverter<IDL> {
    using typename WebCore::DefaultConverter<IDL>::ReturnType;

    static constexpr bool takesContext = true;
};

template<typename IDL>
struct DefaultTryConverter : DefaultContextConverter<IDL> {
    using typename DefaultContextConverter<IDL>::ReturnType;

    // Inlined so that a value of the right type costs its test and nothing else.
    template<IDLConversionContext Ctx>
    ALWAYS_INLINE static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto result = WebCore::Converter<IDL>::tryConvert(globalObject, value, ctx);
        if (result.has_value()) [[likely]] {
            scope.release();
            return WTF::move(*result);
        }
        RETURN_IF_EXCEPTION(scope, {});
        throwConversionFailedSlow(globalObject, scope, ctx);
        return ReturnType {};
    }

private:
    template<IDLConversionContext Ctx>
    NEVER_INLINE static void throwConversionFailedSlow(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        WebCore::Converter<IDL>::throwConversionFailed(globalObject, scope, ctx);
    }
};

}
