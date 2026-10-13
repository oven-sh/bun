#pragma once
#include <BunIDLConvert.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include "IDLTypes.h"
#include "IDLConvertBase.h"

namespace Bun {
template<> struct IDLHumanReadableName<Bindgen::IDLStrictUTF8String> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("string");
};
template<> struct IDLHumanReadableName<Bindgen::IDLLooseUTF8String> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<> struct IDLHumanReadableName<Bindgen::IDLBufferSourceBytes> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer or ArrayBufferView");
};
template<> struct IDLHumanReadableName<Bindgen::IDLRawBufferSource> : IDLHumanReadableName<Bindgen::IDLBufferSourceBytes> {};

namespace Bindgen {

// std::nullopt for anything else, a shared buffer included. A detached or out-of-bounds view is empty.
inline std::optional<std::span<const uint8_t>> unsharedBufferSourceSpan(JSC::JSValue value)
{
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        if (view->isShared())
            return std::nullopt;
        return view->span();
    }
    if (auto* buffer = dynamicDowncast<JSC::JSArrayBuffer>(value)) {
        if (buffer->isShared())
            return std::nullopt;
        return buffer->impl()->span();
    }
    return std::nullopt;
}

}
}

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictUTF8String> : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictUTF8String> {
    // Not through tryConvert's std::optional: the view is large, and this way it is never moved.
    template<Bun::IDLConversionContext Ctx>
    static Bun::Bindgen::JSStringUTF8View convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (value.isString()) [[likely]]
            return Bun::Bindgen::JSStringUTF8View::create(globalObject, JSC::asString(value));
        return Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictUTF8String>::convert(globalObject, value, ctx);
    }

    template<Bun::IDLConversionContext Ctx>
    static std::optional<Bun::Bindgen::JSStringUTF8View> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        if (value.isString()) [[likely]]
            return Bun::Bindgen::JSStringUTF8View::create(globalObject, JSC::asString(value));
        if (!value.isCell() || (value.asCell()->type() != JSC::StringObjectType && value.asCell()->type() != JSC::DerivedStringObjectType))
            return std::nullopt;
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, Bun::Bindgen::JSStringUTF8View {});
        RELEASE_AND_RETURN(scope, Bun::Bindgen::JSStringUTF8View::create(globalObject, string));
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotString(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLLooseUTF8String> : WebCore::DefaultConverter<Bun::Bindgen::IDLLooseUTF8String> {
    static Bun::Bindgen::JSStringUTF8View convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, Bun::Bindgen::JSStringUTF8View::create(globalObject, string));
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLBufferSourceBytes> : Bun::DefaultTryConverter<Bun::Bindgen::IDLBufferSourceBytes> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<std::span<const uint8_t>> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        auto bytes = Bun::Bindgen::unsharedBufferSourceSpan(value);
        // Null data is the null value.
        if (bytes && !bytes->data())
            return std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(""), 0 };
        return bytes;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "an ArrayBuffer or ArrayBufferView that is not shared"_s);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawBufferSource> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawBufferSource> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (!Bun::Bindgen::unsharedBufferSourceSpan(value))
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "an ArrayBuffer or ArrayBufferView that is not shared"_s);
    }
};

template<typename JSClass>
struct WebCore::Converter<Bun::Bindgen::IDLRawInterface<JSClass>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawInterface<JSClass>> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSClass*> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (auto* object = dynamicDowncast<JSClass>(value))
            return object;
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, WTF::makeString("an instance of "_s, JSClass::info()->className));
    }
};
