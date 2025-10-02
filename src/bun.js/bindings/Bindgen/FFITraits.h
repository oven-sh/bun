#pragma once
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <type_traits>
#include <utility>
#include <variant>
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/text/WTFString.h>
#include <wtf/Ref.h>
#include <wtf/RefPtr.h>
#include <StrongRef.h>
#include "FFIUnion.h"

namespace Bun::Bindgen {

template<typename T>
struct FFITraits;

template<typename T>
struct TrivialFFI {
    using FFIType = T;

    static FFIType convertToFFI(T&& cppValue)
    {
        return std::move(cppValue);
    }
};

template<> struct FFITraits<bool> : TrivialFFI<bool> {};
template<> struct FFITraits<std::int8_t> : TrivialFFI<std::int8_t> {};
template<> struct FFITraits<std::uint8_t> : TrivialFFI<std::uint8_t> {};
template<> struct FFITraits<std::int16_t> : TrivialFFI<std::int16_t> {};
template<> struct FFITraits<std::uint16_t> : TrivialFFI<std::uint16_t> {};
template<> struct FFITraits<std::int32_t> : TrivialFFI<std::int32_t> {};
template<> struct FFITraits<std::uint32_t> : TrivialFFI<std::uint32_t> {};
template<> struct FFITraits<std::int64_t> : TrivialFFI<std::int64_t> {};
template<> struct FFITraits<std::uint64_t> : TrivialFFI<std::uint64_t> {};
template<> struct FFITraits<float> : TrivialFFI<float> {};
template<> struct FFITraits<double> : TrivialFFI<double> {};

enum FFINullPtr : std::uint8_t {};

template<> struct FFITraits<std::nullptr_t> {
    using FFIType = FFINullPtr;

    static FFIType convertToFFI(std::nullptr_t cppValue)
    {
        return FFIType { 0 };
    }
};

template<> struct FFITraits<std::monostate> {
    using FFIType = FFINullPtr;

    static FFIType convertToFFI(std::monostate cppValue)
    {
        return FFIType { 0 };
    }
};

template<typename... Args>
struct FFIVariant {
    FFIUnion<Args...> data;
    std::uint8_t tag;

    static_assert(sizeof...(Args) > 0);
    static_assert(sizeof...(Args) - 1 <= std::numeric_limits<std::uint8_t>::max());

    explicit FFIVariant(std::variant<Args...>&& variant)
        : tag(static_cast<std::uint8_t>(variant.index()))
        , data(std::move(variant))
    {
    }
};

template<typename... Args>
struct FFITraits<std::variant<Args...>> {
    using FFIType = FFIVariant<typename FFITraits<Args>::FFIType...>;

    static FFIType convertToFFI(std::variant<Args...>&& cppValue)
    {
        using VariantOfFFI = std::variant<typename FFITraits<Args>::FFIType...>;
        return FFIType { std::visit([](auto&& arg) -> VariantOfFFI {
            using ArgType = std::decay_t<decltype(arg)>;
            return { FFITraits<ArgType>::convertToFFI(std::move(arg)) };
        },
            std::move(cppValue)) };
    }
};

template<typename T>
struct FFITraits<std::optional<T>> {
    using FFIType = FFIVariant<FFINullPtr, typename FFITraits<T>::FFIType>;

    static FFIType convertToFFI(std::optional<T>&& cppValue)
    {
        using StdVariant = std::variant<FFINullPtr, typename FFITraits<T>::FFIType>;
        if (!cppValue) {
            return FFIType { StdVariant { FFINullPtr {} } };
        }
        return FFIType { StdVariant { FFITraits<T>::convertToFFI(std::move(*cppValue)) } };
    }
};

template<> struct FFITraits<WTF::String> {
    using FFIType = WTF::StringImpl*;

    static FFIType convertToFFI(WTF::String&& cppValue)
    {
        return cppValue.releaseImpl().leakRef();
    }
};

template<> struct FFITraits<JSC::JSValue> {
    using FFIType = JSC::EncodedJSValue;

    static FFIType convertToFFI(JSC::JSValue cppValue)
    {
        return JSC::JSValue::encode(cppValue);
    }
};

template<> struct FFITraits<Bun::StrongRef> {
    using FFIType = JSC::JSValue*;

    static FFIType convertToFFI(Bun::StrongRef&& cppValue)
    {
        return cppValue.release();
    }
};

template<typename T, typename P, typename R> struct FFITraits<WTF::Ref<T, P, R>> {
    using FFIType = T*;

    static FFIType convertToFFI(WTF::Ref<T, P, R>&& cppValue)
    {
        return &cppValue.leakRef();
    }
};

template<typename T, typename P, typename R> struct FFITraits<WTF::RefPtr<T, P, R>> {
    using FFIType = T*;

    static FFIType convertToFFI(WTF::RefPtr<T, P, R>&& cppValue)
    {
        return cppValue.leakRef();
    }
};

}
