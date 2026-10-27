#pragma once
#include <algorithm>
#include <bit>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <type_traits>
#include <utility>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/NativeFunction.h>
#include <wtf/text/WTFString.h>
#include <wtf/RefPtr.h>
#include <wtf/StdLibExtras.h>
#include "Bindgen/JSBytesView.h"
#include "Bindgen/JSStringUTF8View.h"
#include "helpers.h"

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

// `convertToExtern` of a `T` is a std::bit_cast: `T` is trivially copyable and is represented as its ExternType.
template<typename T>
inline constexpr bool canBitCastToExtern = std::derived_from<ExternTraits<T>, TrivialExtern<T>>;

// For an argument that Rust takes by pointer: a pointer to `value` itself. A pointer to `toExtern(value)` costs a
// store-forwarding stall, since the copy loads in one piece what the conversion has just stored in several.
template<typename T>
    requires canBitCastToExtern<T>
ALWAYS_INLINE auto* asExtern(T& value)
{
    using ExternType = typename ExternTraits<T>::ExternType;
    static_assert(alignof(T) == alignof(ExternType));
    return reinterpret_cast<ExternType*>(&value);
}

// `uint64_t bits`, the first member of a generated union whose `data` is 8 bytes and so is a parameter of its own.
// Nothing reads it in `Extern<Name>::data`. With it clang gives that parameter the LLVM type `i64`, as rustc does.
// Without it the type is `ptr` when the first member is a pointer.
// `<Name>` has it when `toExtern` is a bit-cast and an alternative is narrower than `data`. The converter stores that
// alternative through it, in one store as wide as the load that follows.

// The bytes of `value`, then zeros.
template<typename T>
    requires(canBitCastToExtern<T> && sizeof(T) < sizeof(uint64_t))
ALWAYS_INLINE uint64_t toBits(T value)
{
    uint64_t bits = 0;
    memcpySpan(asMutableByteSpan(bits), asByteSpan(value));
    return bits;
}

template<> struct ExternTraits<bool> : TrivialExtern<bool> {};
template<> struct ExternTraits<uint8_t> : TrivialExtern<uint8_t> {};
template<> struct ExternTraits<uint16_t> : TrivialExtern<uint16_t> {};
template<> struct ExternTraits<int32_t> : TrivialExtern<int32_t> {};
template<> struct ExternTraits<uint32_t> : TrivialExtern<uint32_t> {};
template<> struct ExternTraits<int64_t> : TrivialExtern<int64_t> {};
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
template<> inline constexpr bool canBitCastToExtern<JSC::JSValue> = true;

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

template<> struct ExternTraits<JSC::GCOwnedDataScope<WTF::StringView>> {
    using ExternType = EncodedSlice;

    // The caller's `cppValue` keeps the characters' owner alive for the whole call.
    static ExternType convertToExtern(JSC::GCOwnedDataScope<WTF::StringView>&& cppValue)
    {
        return Zig::toEncodedSlice(cppValue.data);
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

struct ExternVariadicArguments {
    const JSC::EncodedJSValue* data;
    size_t length;
};

template<> struct ExternTraits<JSC::ArgList> {
    using ExternType = ExternVariadicArguments;

    static ExternType convertToExtern(JSC::ArgList&& cppValue)
    {
        return { cppValue.data(), cppValue.size() };
    }
};

// `data()` is never null, which a Rust slice needs.
inline JSC::ArgList variadicArguments(JSC::CallFrame* callFrame, unsigned startIndex)
{
    return { callFrame, static_cast<int>(std::min<size_t>(startIndex, callFrame->argumentCount())) };
}

// What `$bindgen` returns for a function.
JSC::EncodedJSValue createFunction(JSC::JSGlobalObject*, unsigned length, ASCIILiteral name, JSC::NativeFunction);

// A converted argument and the argument itself.
template<typename T>
struct ExternWithValue {
    T converted;
    JSC::EncodedJSValue value;
};

// What IDLWithValue converts to.
template<typename T>
struct WithValue {
    T converted {};
    JSC::JSValue value {};
};

template<typename T> struct ExternTraits<WithValue<T>> {
    using ExternType = ExternWithValue<typename ExternTraits<T>::ExternType>;

    static ExternType convertToExtern(WithValue<T>&& cppValue)
    {
        return { ExternTraits<T>::convertToExtern(WTF::move(cppValue.converted)), JSC::JSValue::encode(cppValue.value) };
    }
};
template<typename T> inline constexpr bool canBitCastToExtern<WithValue<T>> = canBitCastToExtern<T>;

template<typename T, typename P, typename R> struct ExternTraits<WTF::RefPtr<T, P, R>> {
    using ExternType = T*;

    static ExternType convertToExtern(WTF::RefPtr<T, P, R>&& cppValue)
    {
        return cppValue.leakRef();
    }
};

}
