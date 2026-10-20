#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <utility>
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/text/WTFString.h>
#include <wtf/RefPtr.h>
#include "Bindgen/JSBytesView.h"
#include "Bindgen/JSStringUTF8View.h"

namespace Bun::Bindgen {

template<typename T>
struct ExternTraits;

template<typename IDL>
using ExternOf = typename ExternTraits<typename IDL::ImplementationType>::ExternType;

// What Rust is passed. It owns what `value` owned.
template<typename T>
ALWAYS_INLINE auto toExtern(T& value)
{
    return ExternTraits<T>::convertToExtern(WTF::move(value));
}

template<typename T>
struct TrivialExtern {
    using ExternType = T;

    static ExternType convertToExtern(T&& cppValue)
    {
        return WTF::move(cppValue);
    }
};

template<> struct ExternTraits<bool> : TrivialExtern<bool> {};
template<> struct ExternTraits<uint8_t> : TrivialExtern<uint8_t> {};
template<> struct ExternTraits<uint16_t> : TrivialExtern<uint16_t> {};
template<> struct ExternTraits<int32_t> : TrivialExtern<int32_t> {};
template<> struct ExternTraits<uint32_t> : TrivialExtern<uint32_t> {};
template<> struct ExternTraits<uint64_t> : TrivialExtern<uint64_t> {};
template<> struct ExternTraits<double> : TrivialExtern<double> {};
template<> struct ExternTraits<void*> : TrivialExtern<void*> {};

enum ExternNullPtr : uint8_t {};

template<> struct ExternTraits<std::nullptr_t> {
    using ExternType = ExternNullPtr;

    static ExternType convertToExtern(std::nullptr_t cppValue)
    {
        return ExternType { 0 };
    }
};

template<typename T>
struct ExternOptional {
    union {
        ExternNullPtr none;
        T some;
    } data;
    uint8_t tag;
};

template<typename T>
struct ExternTraits<std::optional<T>> {
    using ExternType = ExternOptional<typename ExternTraits<T>::ExternType>;

    static ExternType convertToExtern(std::optional<T>&& cppValue)
    {
        ExternType result;
        result.tag = cppValue.has_value();
        if (cppValue)
            result.data.some = ExternTraits<T>::convertToExtern(WTF::move(*cppValue));
        else
            result.data.none = ExternNullPtr {};
        return result;
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
    const uint8_t* data;
    size_t length;
};

template<> struct ExternTraits<std::span<const uint8_t>> {
    using ExternType = ExternBytes;

    static ExternType convertToExtern(std::span<const uint8_t> cppValue)
    {
        return { cppValue.data(), cppValue.size() };
    }
};

template<> struct ExternTraits<JSStringUTF8View> {
    using ExternType = ExternBytes;

    // The storage stays with `cppValue`, which outlives the call this is an argument of.
    static ExternType convertToExtern(JSStringUTF8View&& cppValue)
    {
        return ExternTraits<std::span<const uint8_t>>::convertToExtern(cppValue.bytes());
    }
};

template<> struct ExternTraits<JSBlobOrBufferView> {
    using ExternType = ExternBytes;

    static ExternType convertToExtern(JSBlobOrBufferView&& cppValue)
    {
        return ExternTraits<std::span<const uint8_t>>::convertToExtern(cppValue.bytes());
    }
};

template<> struct ExternTraits<JSBytesView> {
    using ExternType = ExternBytes;

    // As for JSStringUTF8View.
    static ExternType convertToExtern(JSBytesView&& cppValue)
    {
        return ExternTraits<std::span<const uint8_t>>::convertToExtern(cppValue.bytes());
    }
};

template<> struct ExternTraits<JSBlobOrStringOrBuffer> {
    using ExternType = WTF::StringImpl*;

    static ExternType convertToExtern(JSBlobOrStringOrBuffer&& cppValue)
    {
        return ExternTraits<WTF::String>::convertToExtern(cppValue.takeString());
    }
};

// A converted argument and the argument itself.
template<typename T>
struct ExternWithValue {
    T converted;
    JSC::EncodedJSValue value;
};

template<typename T, typename P, typename R> struct ExternTraits<WTF::RefPtr<T, P, R>> {
    using ExternType = T*;

    static ExternType convertToExtern(WTF::RefPtr<T, P, R>&& cppValue)
    {
        return cppValue.leakRef();
    }
};

}
