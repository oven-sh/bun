#pragma once
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <span>
#include <type_traits>
#include <utility>
#include <variant>
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/text/WTFString.h>
#include <wtf/Ref.h>
#include <wtf/RefPtr.h>
#include "ExternUnion.h"
#include "JSStringUTF8View.h"

namespace Bun::Bindgen {

template<typename T>
struct ExternTraits;

template<typename T>
struct TrivialExtern {
    using ExternType = T;

    static ExternType convertToExtern(T&& cppValue)
    {
        return std::move(cppValue);
    }
};

template<> struct ExternTraits<bool> : TrivialExtern<bool> {};
template<> struct ExternTraits<std::int8_t> : TrivialExtern<std::int8_t> {};
template<> struct ExternTraits<std::uint8_t> : TrivialExtern<std::uint8_t> {};
template<> struct ExternTraits<std::int16_t> : TrivialExtern<std::int16_t> {};
template<> struct ExternTraits<std::uint16_t> : TrivialExtern<std::uint16_t> {};
template<> struct ExternTraits<std::int32_t> : TrivialExtern<std::int32_t> {};
template<> struct ExternTraits<std::uint32_t> : TrivialExtern<std::uint32_t> {};
template<> struct ExternTraits<std::int64_t> : TrivialExtern<std::int64_t> {};
template<> struct ExternTraits<std::uint64_t> : TrivialExtern<std::uint64_t> {};
template<> struct ExternTraits<float> : TrivialExtern<float> {};
template<> struct ExternTraits<double> : TrivialExtern<double> {};

enum ExternNullPtr : std::uint8_t {};

template<> struct ExternTraits<std::nullptr_t> {
    using ExternType = ExternNullPtr;

    static ExternType convertToExtern(std::nullptr_t cppValue)
    {
        return ExternType { 0 };
    }
};

template<> struct ExternTraits<std::monostate> {
    using ExternType = ExternNullPtr;

    static ExternType convertToExtern(std::monostate cppValue)
    {
        return ExternType { 0 };
    }
};

template<typename... Args>
struct ExternVariant {
    ExternUnion<Args...> data;
    std::uint8_t tag;

    static_assert(sizeof...(Args) > 0);
    static_assert(sizeof...(Args) - 1 <= std::numeric_limits<std::uint8_t>::max());

    explicit ExternVariant(std::variant<Args...>&& variant)
        : data(std::move(variant))
        , tag(static_cast<std::uint8_t>(variant.index()))
    {
    }
};

template<typename... Args>
struct ExternTraits<std::variant<Args...>> {
    using ExternType = ExternVariant<typename ExternTraits<Args>::ExternType...>;

    static ExternType convertToExtern(std::variant<Args...>&& cppValue)
    {
        using VariantOfExtern = std::variant<typename ExternTraits<Args>::ExternType...>;
        return ExternType { std::visit([](auto&& arg) -> VariantOfExtern {
            using ArgType = std::decay_t<decltype(arg)>;
            return { ExternTraits<ArgType>::convertToExtern(std::move(arg)) };
        },
            std::move(cppValue)) };
    }
};

template<typename T>
struct ExternTraits<std::optional<T>> {
    using ExternType = ExternVariant<ExternNullPtr, typename ExternTraits<T>::ExternType>;

    static ExternType convertToExtern(std::optional<T>&& cppValue)
    {
        using StdVariant = std::variant<ExternNullPtr, typename ExternTraits<T>::ExternType>;
        if (!cppValue) {
            return ExternType { StdVariant { ExternNullPtr {} } };
        }
        return ExternType { StdVariant { ExternTraits<T>::convertToExtern(std::move(*cppValue)) } };
    }
};

template<> struct ExternTraits<WTF::String> {
    using ExternType = WTF::StringImpl*;

    static ExternType convertToExtern(WTF::String&& cppValue)
    {
        return cppValue.releaseImpl().leakRef();
    }
};

template<> struct ExternTraits<JSC::JSValue> {
    using ExternType = JSC::EncodedJSValue;

    static ExternType convertToExtern(JSC::JSValue cppValue)
    {
        return JSC::JSValue::encode(cppValue);
    }
};

struct ExternBytes {
    const std::uint8_t* data;
    std::size_t length;
};

template<> struct ExternTraits<std::span<const std::uint8_t>> {
    using ExternType = ExternBytes;

    static ExternType convertToExtern(std::span<const std::uint8_t> cppValue)
    {
        return { cppValue.data(), cppValue.size() };
    }
};

template<> struct ExternTraits<JSStringUTF8View> {
    using ExternType = ExternBytes;

    // The storage stays with `cppValue`, which outlives the call this is an argument of.
    static ExternType convertToExtern(JSStringUTF8View&& cppValue)
    {
        return ExternTraits<std::span<const std::uint8_t>>::convertToExtern(cppValue.bytes());
    }
};

// A converted argument and the argument itself.
template<typename T>
struct ExternWithValue {
    T converted;
    JSC::EncodedJSValue value;
};

template<typename T, typename P, typename R> struct ExternTraits<WTF::Ref<T, P, R>> {
    using ExternType = T*;

    static ExternType convertToExtern(WTF::Ref<T, P, R>&& cppValue)
    {
        return &cppValue.leakRef();
    }
};

template<typename T, typename P, typename R> struct ExternTraits<WTF::RefPtr<T, P, R>> {
    using ExternType = T*;

    static ExternType convertToExtern(WTF::RefPtr<T, P, R>&& cppValue)
    {
        return cppValue.leakRef();
    }
};

}
