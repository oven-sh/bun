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

// False if it threw. A converter with `convertInto` reports that itself, as WebCore's ConversionResult does. For any other, this asks the VM.
template<typename T, IDLConversionContext Ctx, typename Result>
ALWAYS_INLINE bool convertIDLInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Result& result)
{
    if constexpr (requires { WebCore::Converter<T>::convertInto(globalObject, value, ctx, result); }) {
        return WebCore::Converter<T>::convertInto(globalObject, value, ctx, result);
    } else {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        result = convertIDL<T>(globalObject, value, ctx);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }
}

// std::nullopt if it refused the value or threw.
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
    template<IDLConversionContext Ctx, typename Result>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Result& result)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto converted = WebCore::Converter<IDL>::tryConvert(globalObject, value, ctx);
        if (converted.has_value()) [[likely]] {
            scope.release();
            result = WTF::move(*converted);
            return true;
        }
        throwConversionFailedSlow(globalObject, scope, ctx);
        return false;
    }

    template<IDLConversionContext Ctx>
    ALWAYS_INLINE static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        ReturnType result {};
        convertInto(globalObject, value, ctx, result);
        return result;
    }

private:
    template<IDLConversionContext Ctx>
    NEVER_INLINE static void throwConversionFailedSlow(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        RETURN_IF_EXCEPTION(scope, void());
        WebCore::Converter<IDL>::throwConversionFailed(globalObject, scope, ctx);
    }
};

}
