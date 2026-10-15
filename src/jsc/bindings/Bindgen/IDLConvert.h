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
template<> struct IDLHumanReadableName<Bindgen::IDLStrictStringOrStringObject> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<> struct IDLHumanReadableName<Bindgen::IDLBufferSourceBytes> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer or ArrayBufferView");
};
template<> struct IDLHumanReadableName<Bindgen::IDLRawBufferSource> : IDLHumanReadableName<Bindgen::IDLBufferSourceBytes> {};

namespace Bindgen {

inline bool isStringObject(JSC::JSValue value)
{
    return value.isCell() && (value.asCell()->type() == JSC::StringObjectType || value.asCell()->type() == JSC::DerivedStringObjectType);
}

// A BigInt that is not a cell.
inline bool isBigInt32(JSC::JSValue value)
{
#if USE(BIGINT32)
    return value.isBigInt32();
#else
    UNUSED_PARAM(value);
    return false;
#endif
}

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

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictUTF8String> : Bun::DefaultContextConverter<Bun::Bindgen::IDLStrictUTF8String> {
    template<Bun::IDLConversionContext Ctx>
    static void convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Bun::Bindgen::JSStringUTF8View& result)
    {
        if (value.isString()) [[likely]]
            return result.initialize(globalObject, JSC::asString(value));
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!Bun::Bindgen::isStringObject(value)) {
            ctx.throwNotString(globalObject, scope);
            return;
        }
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, result.initialize(globalObject, string));
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictStringOrStringObject> : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictStringOrStringObject> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<WTF::String> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        if (value.isString() || Bun::Bindgen::isStringObject(value)) [[likely]]
            return value.toWTFString(&globalObject);
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotString(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLLooseUTF8String> : Bun::DefaultContextConverter<Bun::Bindgen::IDLLooseUTF8String> {
    template<Bun::IDLConversionContext Ctx>
    static void convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&, Bun::Bindgen::JSStringUTF8View& result)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, result.initialize(globalObject, string));
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
