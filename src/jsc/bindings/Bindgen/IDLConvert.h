#pragma once
#include "Bindgen/IDLConvertBase.h"
#include "Bindgen/IDLConvertNumbers.h"
#include "Bindgen/IDLTypes.h"
#include "BunIDLConvertSequence.h"
#include "JSDOMConvert.h"
#include "JSDOMConvertOptional.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/StringObject.h>
#include <utility>

namespace Bun {
template<> struct IDLHumanReadableName<Bindgen::IDLStrictNull> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("null");
};

template<typename IDL>
struct IDLHumanReadableName<Bindgen::IDLFalsyAsNull<IDL>>
    : IDLHumanReadableName<WebCore::IDLNullable<IDL>> {};

template<HasIDLHumanReadableName IDL>
struct IDLHumanReadableName<Bindgen::IDLArray<IDL>> : BaseIDLHumanReadableName {
    static constexpr bool hasPreposition = true;
    static constexpr auto humanReadableName
        = Bun::concatCStrings("array of ", Detail::nestedHumanReadableName<IDL>());
};

// A union with this alternative takes every value, so nothing reports it.
template<> struct IDLHumanReadableName<Bindgen::IDLRawAny> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("any value");
};

template<> struct IDLHumanReadableName<Bindgen::IDLArrayBufferRef> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer");
};

template<> struct IDLHumanReadableName<Bindgen::IDLBlobRef> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("Blob");
};

template<> struct IDLHumanReadableName<Bindgen::IDLStrictUTF8String> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("string");
};
template<> struct IDLHumanReadableName<Bindgen::IDLLooseUTF8String> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<> struct IDLHumanReadableName<Bindgen::IDLBufferSourceBytes> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer or ArrayBufferView");
};
template<> struct IDLHumanReadableName<Bindgen::IDLRawBufferSource> : IDLHumanReadableName<Bindgen::IDLBufferSourceBytes> {};

namespace Bindgen {

// Specialized by generated code. `result` was just default-constructed.
template<typename T>
void convertDictionaryInto(JSC::JSGlobalObject&, JSC::JSValue, T& result);

template<IDLConversionContext Ctx>
void throwNotUnsharedBufferSource(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
{
    ctx.throwTypeMustBe(globalObject, scope, "an ArrayBuffer or ArrayBufferView that is not shared"_s);
}

// std::nullopt for anything else, a shared buffer included. A detached or out-of-bounds view is empty.
inline std::optional<std::span<const uint8_t>> unsharedBufferSourceSpan(JSC::VM& vm, JSC::JSValue value)
{
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        if (view->isShared())
            return std::nullopt;
        return view->span();
    }
    if (auto* buffer = JSC::toUnsharedArrayBuffer(vm, value))
        return buffer->span();
    return std::nullopt;
}

}
}

namespace Bun::Bindgen::Detail {
template<typename IDL>
struct UTF8StringConverter : DefaultContextConverter<IDL> {
    template<IDLConversionContext Ctx>
    ALWAYS_INLINE static void convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, JSStringUTF8View& result)
    {
        if (value.isString()) [[likely]]
            return result.initialize(globalObject, JSC::asString(value));
        convertIntoSlow(globalObject, value, ctx, result);
    }

private:
    template<IDLConversionContext Ctx>
    NEVER_INLINE static void convertIntoSlow(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, JSStringUTF8View& result)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if constexpr (std::same_as<IDL, IDLStrictUTF8String>) {
            if (!value.inherits<JSC::StringObject>()) {
                ctx.throwNotString(globalObject, scope);
                return;
            }
        }
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, result.initialize(globalObject, string));
    }
};
}

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictUTF8String> : Bun::Bindgen::Detail::UTF8StringConverter<Bun::Bindgen::IDLStrictUTF8String> {};
template<> struct WebCore::Converter<Bun::Bindgen::IDLLooseUTF8String> : Bun::Bindgen::Detail::UTF8StringConverter<Bun::Bindgen::IDLLooseUTF8String> {};

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictStringOrStringObject> : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictStringOrStringObject> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<WTF::String> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        if (value.isString() || value.inherits<JSC::StringObject>()) [[likely]]
            return value.toWTFString(&globalObject);
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotString(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLBufferSourceBytes> : Bun::DefaultTryConverter<Bun::Bindgen::IDLBufferSourceBytes> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<std::span<const uint8_t>> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        auto bytes = Bun::Bindgen::unsharedBufferSourceSpan(JSC::getVM(&globalObject), value);
        // Null data is the null value.
        if (bytes && !bytes->data())
            return byteCast<uint8_t>(WTF::nonNullEmptyUTF8Span());
        return bytes;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        Bun::Bindgen::throwNotUnsharedBufferSource(globalObject, scope, ctx);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawBufferSource> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawBufferSource> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        if (!Bun::Bindgen::unsharedBufferSourceSpan(JSC::getVM(&globalObject), value))
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        Bun::Bindgen::throwNotUnsharedBufferSource(globalObject, scope, ctx);
    }
};

template<typename JSClass>
struct WebCore::Converter<Bun::Bindgen::IDLRawInterface<JSClass>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawInterface<JSClass>> {
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

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawAny> : WebCore::DefaultConverter<Bun::Bindgen::IDLRawAny> {
    static JSC::JSValue convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        return value;
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLFalsyAsNull<IDL>>
    : Bun::DefaultContextConverter<Bun::Bindgen::IDLFalsyAsNull<IDL>> {

    using ReturnType = WebCore::Converter<WebCore::IDLNullable<IDL>>::ReturnType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (!value.toBoolean(&globalObject))
            return IDL::nullValue();
        return Bun::convertIDL<IDL>(globalObject, value, ctx);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictBoolean>
    : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictBoolean> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<bool> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isBoolean())
            return value.asBoolean();
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

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictString>
    : Bun::DefaultTryConverter<Bun::Bindgen::IDLStrictString> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<WTF::String> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isString())
            return value.toWTFString(&globalObject);
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
struct WebCore::Converter<Bun::Bindgen::IDLArray<IDL>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLArray<IDL>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<typename Bun::Bindgen::IDLArray<IDL>::ImplementationType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (JSC::isJSArray(value))
            return Bun::convertIDL<typename Bun::Bindgen::IDLArray<IDL>::Base>(globalObject, value, ctx);
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

template<> struct WebCore::Converter<Bun::Bindgen::IDLArrayBufferRef>
    : Bun::DefaultTryConverter<Bun::Bindgen::IDLArrayBufferRef> {

    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<typename Bun::Bindgen::IDLArrayBufferRef::ImplementationType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        if (auto* jsBuffer = JSC::toUnsharedArrayBuffer(vm, value))
            return jsBuffer;
        if (auto* jsView = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
            if (jsView->isShared())
                return std::nullopt;
            // A copy: the view's buffer can hold more than the view shows.
            if (auto bytes = JSC::ArrayBuffer::tryCreate(jsView->span()))
                return bytes;
            // Declared where it throws: at the top, every caller would owe a check for the paths that cannot.
            auto scope = DECLARE_THROW_SCOPE(vm);
            JSC::throwOutOfMemoryError(&globalObject, scope);
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        Bun::Bindgen::throwNotUnsharedBufferSource(globalObject, scope, ctx);
    }
};
