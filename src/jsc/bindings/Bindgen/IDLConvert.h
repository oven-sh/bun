#pragma once
#include "Bindgen/IDLConvertBase.h"
#include "Bindgen/IDLConvertNumbers.h"
#include "Bindgen/IDLTypes.h"
#include "Bindgen/JSBytesView.h"
#include "JSDOMConvert.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/StringObject.h>
#include <optional>
#include <utility>
#include <wtf/ScopedLambda.h>

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

template<typename IDL>
struct IDLHumanReadableName<Bindgen::IDLIfPassed<IDL>>
    : IDLHumanReadableName<IDL> {};

template<> struct IDLHumanReadableName<Bindgen::IDLStrictDoubleOrDate> : BaseIDLHumanReadableName {
    static constexpr bool isDisjunction = true;
    static constexpr auto humanReadableName = std::to_array("number or Date");
};

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
template<> struct IDLHumanReadableName<Bindgen::IDLRawString> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<Bindgen::WebString kind, bool nullToEmpty> struct IDLHumanReadableName<Bindgen::IDLWebString<kind, nullToEmpty>> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<typename IDL> struct IDLHumanReadableName<Bindgen::IDLStringImplOf<IDL>> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<typename IDL> struct IDLHumanReadableName<Bindgen::IDLAtomOf<IDL>> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<bool allowStringObject> struct IDLHumanReadableName<Bindgen::IDLStringView<allowStringObject>> : IDLHumanReadableName<Bindgen::IDLStrictUTF8String> {};
template<bool allowShared> struct IDLHumanReadableName<Bindgen::IDLRawBufferSource<allowShared>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer or ArrayBufferView");
};

template<typename JSClass, bool allowShared> struct IDLHumanReadableName<Bindgen::IDLRawBuffer<JSClass, allowShared>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("buffer");
};
template<typename IDL> struct IDLHumanReadableName<Bindgen::IDLSequenceList<IDL>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("sequence");
};
template<typename IDL> struct IDLHumanReadableName<Bindgen::IDLSequenceVector<IDL>> : IDLHumanReadableName<Bindgen::IDLSequenceList<IDL>> {};
template<typename Key, typename IDL> struct IDLHumanReadableName<Bindgen::IDLRecordList<Key, IDL>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("record");
};

template<> struct IDLHumanReadableName<Bindgen::IDLRawCallable> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("function");
};

template<> struct IDLHumanReadableName<Bindgen::IDLRawObject> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("object");
};

template<> struct IDLHumanReadableName<Bindgen::IDLRawArray> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("array");
};

template<> struct IDLHumanReadableName<Bindgen::IDLStrictUndefined> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("undefined");
};

template<typename JSClass, auto name> struct IDLHumanReadableName<Bindgen::IDLWrappedInterface<JSClass, name>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = name;
};

namespace Bindgen {

// Specialized by generated code. `result` was just default-constructed. False if it threw.
template<typename T>
bool convertDictionaryInto(JSC::JSGlobalObject&, JSC::JSValue, T& result);

template<typename T, IDLConversionContext Ctx>
bool convertDictionaryInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, T& result, Ctx& ctx)
{
    // The dictionary names itself. `expected` names the argument.
    using Context = std::remove_const_t<Ctx>;
    if constexpr (std::is_same_v<Context, NodeArgumentContext> || std::is_same_v<Context, ArgumentMessageContext>) {
        if (!value.isObject()) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
            ctx.throwNotObject(globalObject, scope);
            return false;
        }
    }
    return convertDictionaryInto(globalObject, value, result);
}

template<IDLConversionContext Ctx>
void throwNotUnsharedBufferSource(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
{
    ctx.throwTypeMustBe(globalObject, scope, "an ArrayBuffer or ArrayBufferView that is not shared"_s);
}

// What `ToString` gives for a `String` object, which runs its `toString`. Any other value as it is.
ALWAYS_INLINE JSC::JSValue stringOfStringObject(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
{
    if (value.inherits<JSC::StringObject>()) [[unlikely]]
        return value.toString(&globalObject);
    return value;
}

// An argument of a function whose body is C++ (`cppSymbol`).
class ArgumentInFrame {
public:
    ALWAYS_INLINE ArgumentInFrame(JSC::JSValue value)
        : m_value(value)
    {
    }

    ALWAYS_INLINE JSC::JSValue value() const { return m_value; }

private:
    JSC::JSValue m_value;
};

// What an inline C++ body (`cppInlineBody`) is handed by the generated host function: `at(n)` reads the argument from the frame of the caller where the body asks for it, and answers undefined for one that is left out.
class ArgumentsInFrame {
public:
    ALWAYS_INLINE explicit ArgumentsInFrame(JSC::CallFrame& callFrame)
        : m_callFrame(callFrame)
    {
    }

    ALWAYS_INLINE JSC::JSValue at(unsigned index) const { return m_callFrame.argument(index); }

private:
    JSC::CallFrame& m_callFrame;
};

// The same from the entry point for compiled code, which passes the arguments in registers and the empty value for one that it leaves out.
template<unsigned count>
class ArgumentsInRegisters {
public:
    template<typename... Values>
    ALWAYS_INLINE ArgumentsInRegisters(Values... values)
        : m_values { values... }
    {
        static_assert(sizeof...(Values) == count);
    }

    ALWAYS_INLINE JSC::JSValue at(unsigned index) const
    {
        JSC::JSValue value = JSC::JSValue::decode(m_values[index]);
        return value ? value : JSC::jsUndefined();
    }

private:
    JSC::EncodedJSValue m_values[count];
};

// `b.rest`: the arguments of a call from `first` on. They stay in the frame of the caller unless one is converted.
// The JS value that stands for a converted value: `bindgen::Element` in Rust. Generated code adds unions.
inline JSC::JSValue asElement(JSC::VM&, JSC::JSValue value) { return value ? value : JSC::jsNull(); }
inline JSC::JSValue asElement(JSC::VM&, JSC::JSCell* cell) { return cell ? JSC::JSValue(cell) : JSC::jsNull(); }
inline JSC::JSValue asElement(JSC::VM&, bool value) { return JSC::jsBoolean(value); }
inline JSC::JSValue asElement(JSC::VM& vm, JSStringAndImpl value)
{
    if (!value.string || value.string->tryGetValueImpl() == value.impl) [[likely]]
        return asElement(vm, value.string);
    return JSC::jsString(vm, WTF::String(value.impl));
}
template<typename T>
    requires(std::is_arithmetic_v<T>)
JSC::JSValue asElement(JSC::VM&, T value)
{
    return JSC::jsNumber(value);
}
template<typename T>
    requires(std::is_enum_v<T>)
JSC::JSValue asElement(JSC::VM&, T value)
{
    return JSC::jsNumber(static_cast<int32_t>(value));
}
template<typename T>
JSC::JSValue asElement(JSC::VM& vm, const std::optional<T>& value)
{
    return value ? asElement(vm, *value) : JSC::jsNull();
}

// Empty if it threw.
template<typename IDL, typename Ctx>
ALWAYS_INLINE JSC::JSValue convertElement(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    typename IDL::ImplementationType converted;
    if (hasException(scope, Bun::convertIDLInto<IDL>(globalObject, value, ctx, converted))) [[unlikely]]
        return {};
    return asElement(vm, converted);
}

using ConvertElement = JSC::JSValue (*)(JSC::JSGlobalObject&, JSC::JSValue);
template<typename IDL>
JSC::JSValue convertElementOfList(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
{
    static constexpr WebConversionContext ctx { "element"_s };
    return convertElement<IDL>(globalObject, value, ctx);
}
// Empty if `value` is not iterable, or if it threw.
JSC::JSValue iteratorMethodOf(JSC::JSGlobalObject&, JSC::JSValue);
// Null if they threw.
JSC::JSCellButterfly* createList(JSC::JSGlobalObject&, JSC::MarkedArgumentBuffer&);
JSC::JSCellButterfly* listFromIterable(JSC::JSGlobalObject&, JSC::JSObject*, JSC::JSValue method, ConvertElement);
void forEachInIterable(JSC::JSGlobalObject&, JSC::JSObject*, JSC::JSValue method, const WTF::ScopedLambda<void(JSC::JSValue)>&);
WTF::String describeInstanceOf(WTF::ASCIILiteral className);
JSC::JSCellButterfly* listFromRecord(JSC::JSGlobalObject&, JSC::JSObject*, ConvertElement key, ConvertElement value);

class RestArguments {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(RestArguments);

public:
    ALWAYS_INLINE RestArguments(JSC::CallFrame& callFrame, unsigned first)
        : m_values(std::bit_cast<const JSC::EncodedJSValue*>(callFrame.addressOfArgumentsStart()) + first)
        , m_size(callFrame.argumentCount() > first ? callFrame.argumentCount() - first : 0)
    {
        static_assert(sizeof(JSC::JSValue) == sizeof(JSC::EncodedJSValue));
    }

    const JSC::EncodedJSValue* data() const { return m_values; }
    size_t size() const { return m_size; }
    JSC::JSValue at(size_t index) const { return JSC::JSValue::decode(m_values[index]); }

    // As stringOfStringObject, in order.
    ALWAYS_INLINE void convertStringObjects(JSC::JSGlobalObject& globalObject)
    {
        for (size_t index = 0; index < m_size; ++index) {
            if (at(index).inherits<JSC::StringObject>()) [[unlikely]]
                return convertStringObjectsSlow(globalObject);
        }
    }

    // False if it threw.
    template<typename IDL, typename Ctx>
    ALWAYS_INLINE bool convertEach(JSC::JSGlobalObject& globalObject, Ctx& ctx)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        for (size_t index = 0; index < m_size; ++index) {
            JSC::JSValue converted = convertElement<IDL>(globalObject, at(index), ctx);
            if (hasException(scope, !!converted)) [[unlikely]]
                return false;
            if (m_converted || converted != at(index)) [[unlikely]]
                appendConverted(index, converted);
        }
        if (m_converted) [[unlikely]]
            m_values = m_converted->data();
        return true;
    }

private:
    NEVER_INLINE void appendConverted(size_t index, JSC::JSValue value)
    {
        if (!m_converted) {
            m_converted.emplace();
            for (size_t i = 0; i < index; ++i)
                m_converted->appendWithCrashOnOverflow(at(i));
        }
        m_converted->appendWithCrashOnOverflow(value);
    }

    NEVER_INLINE void convertStringObjectsSlow(JSC::JSGlobalObject& globalObject)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        auto& converted = m_converted.emplace();
        for (size_t index = 0; index < m_size; ++index) {
            converted.append(stringOfStringObject(globalObject, at(index)));
            RETURN_IF_EXCEPTION(scope, void());
        }
        m_values = converted.data();
    }

    const JSC::EncodedJSValue* m_values;
    const size_t m_size;
    std::optional<JSC::MarkedArgumentBuffer> m_converted;
};

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

    // `expected` is what `options` takes without `ToString`, for the message. False if it threw.
    template<IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Result& result, WTF::ASCIILiteral expected)
    {
        if constexpr (options.fromString) {
            if (value.isString())
                return result.initialize(globalObject, JSC::asString(value));
        }
        if constexpr (options.fromBuffer) {
            if (value.inherits<JSC::JSArrayBufferView>() || value.inherits<JSC::JSArrayBuffer>()) {
                result.initializeAsBlobOrBuffer();
                return true;
            }
        }
        if constexpr (options.fromString || options.toStringOtherwise)
            return convertIntoSlow(globalObject, value, ctx, result, expected);
        else {
            if (!isBlobOrThrow(globalObject, value, ctx, expected))
                return false;
            result.initializeAsBlobOrBuffer();
            return true;
        }
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
    NEVER_INLINE static bool convertIntoSlow(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Result& result, WTF::ASCIILiteral expected)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if constexpr (options.fromBlob) {
            bool isBlob = checkInMemoryBlob(globalObject, value);
            RETURN_IF_EXCEPTION(scope, false);
            if (isBlob) {
                result.initializeAsBlobOrBuffer();
                return true;
            }
        }
        bool isRefused;
        if constexpr (options.toStringOtherwise)
            isRefused = (options.refuseUndefined && value.isUndefined()) || (options.refuseNull && value.isNull());
        else
            isRefused = options.refuseStringObject || !value.inherits<JSC::StringObject>();
        if (isRefused) {
            ctx.throwTypeMustBe(globalObject, scope, expected);
            return false;
        }
        JSC::JSString* string = value.toString(&globalObject);
        RETURN_IF_EXCEPTION(scope, false);
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
        if (!value.isString() && !value.inherits<JSC::StringObject>()) [[unlikely]]
            return std::nullopt;
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto string = value.toWTFString(&globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return string;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotString(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawString> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawString> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSString*> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (value.isString()) [[likely]]
            return JSC::asString(value);
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotString(globalObject, scope);
    }
};

namespace Bun::Bindgen {
// Null if they threw.
JSC::JSString* toWebStringSlow(JSC::JSGlobalObject&, JSC::JSValue, WebString, bool nullToEmpty);
JSStringAndImpl resolveString(JSC::JSGlobalObject&, JSC::JSString*);
JSStringAndImpl atomizeString(JSC::JSGlobalObject&, JSC::JSString*);
JSStringAndImpl atomLiteral(JSC::JSGlobalObject&, WTF::ASCIILiteral);
}

template<Bun::Bindgen::WebString kind, bool nullToEmpty>
struct WebCore::Converter<Bun::Bindgen::IDLWebString<kind, nullToEmpty>> : Bun::DefaultContextConverter<Bun::Bindgen::IDLWebString<kind, nullToEmpty>> {
    template<Bun::IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&, JSC::JSString*& result)
    {
        if (kind == Bun::Bindgen::WebString::DOMString && value.isString()) [[likely]] {
            result = JSC::asString(value);
            return true;
        }
        result = Bun::Bindgen::toWebStringSlow(globalObject, value, kind, nullToEmpty);
        return result;
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLStringImplOf<IDL>> : Bun::DefaultContextConverter<Bun::Bindgen::IDLStringImplOf<IDL>> {
    template<Bun::IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Bun::Bindgen::JSStringAndImpl& result)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        JSC::JSString* string;
        if (Bun::Bindgen::hasException(scope, WebCore::Converter<IDL>::convertInto(globalObject, value, ctx, string))) [[unlikely]]
            return false;
        scope.release();
        if (auto* impl = string->tryGetValueImpl()) [[likely]] {
            result = { string, const_cast<WTF::StringImpl*>(impl) };
            return true;
        }
        result = Bun::Bindgen::resolveString(globalObject, string);
        return result.string;
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLAtomOf<IDL>> : Bun::DefaultContextConverter<Bun::Bindgen::IDLAtomOf<IDL>> {
    template<Bun::IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, Bun::Bindgen::JSStringAndImpl& result)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        JSC::JSString* string;
        if (Bun::Bindgen::hasException(scope, WebCore::Converter<IDL>::convertInto(globalObject, value, ctx, string))) [[unlikely]]
            return false;
        scope.release();
        if (auto* impl = string->tryGetValueImpl(); impl && impl->isAtom()) [[likely]] {
            result = { string, const_cast<WTF::StringImpl*>(impl) };
            return true;
        }
        result = Bun::Bindgen::atomizeString(globalObject, string);
        return result.string;
    }
};

template<bool allowStringObject>
struct WebCore::Converter<Bun::Bindgen::IDLStringView<allowStringObject>> : Bun::DefaultContextConverter<Bun::Bindgen::IDLStringView<allowStringObject>> {
    template<Bun::IDLConversionContext Ctx>
    ALWAYS_INLINE static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, JSC::GCOwnedDataScope<WTF::StringView>& result)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSString* string;
        if (value.isString()) [[likely]]
            string = JSC::asString(value);
        else if (allowStringObject && value.inherits<JSC::StringObject>()) {
            string = value.toString(&globalObject);
            RETURN_IF_EXCEPTION(scope, false);
        } else {
            ctx.throwNotString(globalObject, scope);
            return false;
        }
        result = string->view(&globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
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

template<typename JSClass, bool allowShared>
struct WebCore::Converter<Bun::Bindgen::IDLRawBuffer<JSClass, allowShared>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawBuffer<JSClass, allowShared>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        auto* buffer = dynamicDowncast<JSClass>(value);
        if (!buffer)
            return std::nullopt;
        if constexpr (!allowShared) {
            if (buffer->isShared())
                return std::nullopt;
        }
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwGenericTypeError(globalObject, scope, WTF::makeString(ctx.source(), " must be of type "_s, JSClass::info()->className));
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLSequenceList<IDL>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLSequenceList<IDL>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSCellButterfly*> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        JSC::JSValue method = Bun::Bindgen::iteratorMethodOf(globalObject, value);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!method)
            return std::nullopt;
        auto* list = Bun::Bindgen::listFromIterable(globalObject, JSC::asObject(value), method, Bun::Bindgen::convertElementOfList<IDL>);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return list;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "an iterable object"_s);
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLSequenceVector<IDL>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLSequenceVector<IDL>> {
    using Vector = typename Bun::Bindgen::IDLSequenceVector<IDL>::ImplementationType;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<Vector> tryConvert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        JSC::JSValue method = Bun::Bindgen::iteratorMethodOf(globalObject, value);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!method)
            return std::nullopt;
        Vector result;
        Bun::Bindgen::forEachInIterable(globalObject, JSC::asObject(value), method, [&](JSC::JSValue next) {
            typename IDL::ImplementationType converted;
            if (Bun::convertIDLInto<IDL>(globalObject, next, ctx, converted))
                result.append(WTF::move(converted));
        });
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return result;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "an iterable object"_s);
    }
};

template<typename Key, typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLRecordList<Key, IDL>> : Bun::DefaultContextConverter<Bun::Bindgen::IDLRecordList<Key, IDL>> {
    template<Bun::IDLConversionContext Ctx>
    static bool convertInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, JSC::JSCellButterfly*& result)
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
        if (!value.isObject()) [[unlikely]] {
            ctx.throwTypeMustBe(globalObject, scope, "an object"_s);
            return false;
        }
        scope.release();
        result = Bun::Bindgen::listFromRecord(globalObject, JSC::asObject(value), Bun::Bindgen::convertElementOfList<Key>, Bun::Bindgen::convertElementOfList<IDL>);
        return result;
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

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawObject> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawObject> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (!value.isObject())
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotObject(globalObject, scope);
    }
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawArray> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawArray> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (!value.inherits<JSC::JSArray>())
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwNotArray(globalObject, scope);
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
        ctx.throwTypeMustBe(globalObject, scope, Bun::Bindgen::describeInstanceOf(JSClass::info()->className));
    }
};

template<typename JSClass, auto name>
struct WebCore::Converter<Bun::Bindgen::IDLWrappedInterface<JSClass, name>> : Bun::DefaultTryConverter<Bun::Bindgen::IDLWrappedInterface<JSClass, name>> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<void*> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (auto* object = dynamicDowncast<JSClass>(value))
            return object->wrapped();
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

// No type test: only the promise calls a reaction, with the context it was given.
template<> struct WebCore::Converter<Bun::Bindgen::IDLPromisePtr> : WebCore::DefaultConverter<Bun::Bindgen::IDLPromisePtr> {
    static void* convert(JSC::JSGlobalObject&, JSC::JSValue value)
    {
        return reinterpret_cast<void*>(static_cast<uintptr_t>(value.asDouble()));
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

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLOtherAsNull<IDL>>
    : Bun::DefaultContextConverter<Bun::Bindgen::IDLOtherAsNull<IDL>> {

    using ReturnType = WebCore::Converter<WebCore::IDLNullable<IDL>>::ReturnType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (auto converted = Bun::tryConvertIDL<IDL>(globalObject, value, ctx))
            return WTF::move(*converted);
        return IDL::nullValue();
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLIfPassed<IDL>>
    : Bun::DefaultContextConverter<Bun::Bindgen::IDLIfPassed<IDL>> {

    using ReturnType = WebCore::Converter<WebCore::IDLNullable<IDL>>::ReturnType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (value.isEmpty())
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
        if (!value.isString())
            return std::nullopt;
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto string = value.toWTFString(&globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return string;
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
        if (!value.inherits<JSC::JSArray>())
            return std::nullopt;
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto array = Bun::convertIDL<typename Bun::Bindgen::IDLArray<IDL>::Base>(globalObject, value, ctx);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        return array;
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
            if (auto bytes = Bun::Bindgen::tryCopySensitiveBytes(jsView->span()))
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
