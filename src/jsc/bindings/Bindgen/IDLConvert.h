#pragma once
#include "Bindgen/IDLConvertBase.h"
#include "Bindgen/IDLConvertNumbers.h"
#include "Bindgen/IDLTypes.h"
#include "JSDOMConvert.h"
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

template<typename IDL>
struct IDLHumanReadableName<Bindgen::IDLEmptyStringAsNull<IDL>>
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
template<bool allowShared> struct IDLHumanReadableName<Bindgen::IDLRawBufferSource<allowShared>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer or ArrayBufferView");
};

template<> struct IDLHumanReadableName<Bindgen::IDLRawCallable> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("function");
};

template<typename JSClass, auto name> struct IDLHumanReadableName<Bindgen::IDLWrappedInterface<JSClass, name>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = name;
};

namespace Bindgen {

// Specialized by generated code. `result` was just default-constructed.
template<typename T>
void convertDictionaryInto(JSC::JSGlobalObject&, JSC::JSValue, T& result);

template<typename T, IDLConversionContext Ctx>
void convertDictionaryInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, T& result, Ctx& ctx)
{
    // The dictionary names itself. `expected` names the argument.
    using Context = std::remove_const_t<Ctx>;
    if constexpr (std::is_same_v<Context, NodeArgumentContext> || std::is_same_v<Context, ArgumentMessageContext>) {
        if (!value.isObject()) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
            ctx.throwNotObject(globalObject, scope);
            return;
        }
    }
    convertDictionaryInto(globalObject, value, result);
}

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
template<typename IDL, BytesOptions options>
struct BytesConverter : DefaultContextConverter<IDL> {
    using Result = typename IDL::ImplementationType;

    // `expected` is what `options` takes without `ToString`, for the message. Whether it ran what can throw.
    template<IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Result& result, WTF::ASCIILiteral expected)
    {
        if constexpr (options.fromString) {
            if (value.isString()) {
                result.initialize(globalObject, JSC::asString(value));
                return true;
            }
        }
        if constexpr (options.fromBuffer) {
            if (value.inherits<JSC::JSArrayBufferView>() || value.inherits<JSC::JSArrayBuffer>()) {
                result.initializeAsBlobOrBuffer();
                return false;
            }
        }
        if constexpr (options.fromString || options.toStringOtherwise)
            convertIntoSlow(globalObject, value, ctx, result, expected);
        else if (isBlobOrThrow(globalObject, value, ctx, expected))
            result.initializeAsBlobOrBuffer();
        return true;
    }

private:
    // Does not take `result`, which can then live in registers.
    template<IDLConversionContext Ctx>
    NEVER_INLINE static bool isBlobOrThrow(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, WTF::ASCIILiteral expected)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if constexpr (options.fromBlob) {
            bool isBlob = checkInMemoryBlob(globalObject, value);
            RETURN_IF_EXCEPTION(scope, false);
            if (isBlob)
                return true;
        }
        ctx.throwTypeMustBe(globalObject, scope, expected);
        return false;
    }

    template<IDLConversionContext Ctx>
    NEVER_INLINE static void convertIntoSlow(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Result& result, WTF::ASCIILiteral expected)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if constexpr (options.fromBlob) {
            bool isBlob = checkInMemoryBlob(globalObject, value);
            RETURN_IF_EXCEPTION(scope, void());
            if (isBlob)
                return result.initializeAsBlobOrBuffer();
        }
        bool isRefused;
        if constexpr (options.toStringOtherwise)
            isRefused = (options.refuseUndefined && value.isUndefined()) || (options.refuseNull && value.isNull());
        else
            isRefused = options.refuseStringObject || !value.inherits<JSC::StringObject>();
        if (isRefused) {
            ctx.throwTypeMustBe(globalObject, scope, expected);
            return;
        }
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, result.initialize(globalObject, string));
    }
};
}

template<typename Sink, Bun::Bindgen::BytesOptions options>
struct WebCore::Converter<Bun::Bindgen::IDLBytes<Sink, options>>
    : Bun::Bindgen::Detail::BytesConverter<Bun::Bindgen::IDLBytes<Sink, options>, options> {};
template<> struct WebCore::Converter<Bun::Bindgen::IDLStrictUTF8String>
    : Bun::Bindgen::Detail::BytesConverter<Bun::Bindgen::IDLStrictUTF8String, Bun::Bindgen::BytesOptions { .fromString = true }> {};
template<> struct WebCore::Converter<Bun::Bindgen::IDLLooseUTF8String>
    : Bun::Bindgen::Detail::BytesConverter<Bun::Bindgen::IDLLooseUTF8String, Bun::Bindgen::BytesOptions { .fromString = true, .toStringOtherwise = true }> {};

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

template<bool allowShared>
struct WebCore::Converter<Bun::Bindgen::IDLRawBufferSource<allowShared>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawBufferSource<allowShared>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        if constexpr (allowShared) {
            if (!value.inherits<JSC::JSArrayBufferView>() && !value.inherits<JSC::JSArrayBuffer>())
                return std::nullopt;
        } else if (!Bun::Bindgen::unsharedBufferSourceSpan(JSC::getVM(&globalObject), value))
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        if constexpr (allowShared)
            ctx.throwTypeMustBe(globalObject, scope, "an ArrayBuffer or ArrayBufferView"_s);
        else
            Bun::Bindgen::throwNotUnsharedBufferSource(globalObject, scope, ctx);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawCallable> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawCallable> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (!value.isCallable())
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "a function"_s);
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

template<typename JSClass, auto name>
struct WebCore::Converter<Bun::Bindgen::IDLWrappedInterface<JSClass, name>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLWrappedInterface<JSClass, name>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<void*> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (auto* object = dynamicDowncast<JSClass>(value)) {
            if (void* wrapped = object->wrapped())
                return wrapped;
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, WTF::makeString("an instance of "_s, Bun::idlHumanReadableName<Bun::Bindgen::IDLWrappedInterface<JSClass, name>>()));
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

namespace Bun::Bindgen {
inline bool isUndefinedOrNullOrEmptyString(JSC::JSValue value)
{
    return value.isUndefinedOrNull() || (value.isString() && !asString(value)->length());
}
}

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLEmptyStringAsNull<IDL>>
    : Bun::DefaultContextConverter<Bun::Bindgen::IDLEmptyStringAsNull<IDL>> {

    using ReturnType = WebCore::Converter<WebCore::IDLNullable<IDL>>::ReturnType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (Bun::Bindgen::isUndefinedOrNullOrEmptyString(value))
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
