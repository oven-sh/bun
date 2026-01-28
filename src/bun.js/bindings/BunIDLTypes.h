#pragma once
#include "IDLTypes.h"
#include <array>
#include <concepts>
#include <cstddef>
#include <variant>
#include <wtf/Vector.h>

namespace WTF {
struct CrashOnOverflow;
}

namespace Bun {

struct MimallocMalloc;

// Like `IDLAny`, but always stored as a raw `JSValue`. This should only be
// used in contexts where the `JSValue` will be stored on the stack.
struct IDLRawAny : WebCore::IDLType<JSC::JSValue> {
    // Storage in a sequence is explicitly unsupported, as this would create a
    // `Vector<JSValue>`, whose contents are invisible to the GC.
    using SequenceStorageType = void;
    using NullableType = JSC::JSValue;
    using NullableParameterType = JSC::JSValue;
    using NullableInnerParameterType = JSC::JSValue;
    static NullableType nullValue() { return JSC::jsUndefined(); }
    static bool isNullValue(const NullableType& value) { return value.isUndefined(); }
    static ImplementationType extractValueFromNullable(const NullableType& value) { return value; }
};

// For use in unions, to represent a nullable union.
struct IDLStrictNull : WebCore::IDLType<std::nullptr_t> {};

// For use in unions, to represent an optional union.
struct IDLStrictUndefined : WebCore::IDLType<std::monostate> {};

// Treats all falsy values as null.
template<typename IDL>
struct IDLLooseNullable : WebCore::IDLNullable<IDL> {};

template<std::integral T>
struct IDLStrictInteger : WebCore::IDLInteger<T> {};
struct IDLStrictDouble : WebCore::IDLUnrestrictedDouble {};
struct IDLFiniteDouble : WebCore::IDLDouble {};
struct IDLStrictBoolean : WebCore::IDLBoolean {};
struct IDLStrictString : WebCore::IDLDOMString {};

// Converts to a number first.
template<std::integral T>
struct IDLLooseInteger : IDLStrictInteger<T> {};

template<typename... IDL>
struct IDLOrderedUnion : WebCore::IDLType<std::variant<typename IDL::ImplementationType...>> {};

namespace Detail {
template<typename IDL>
using IDLMimallocSequence = WebCore::IDLSequence<
    IDL,
    WTF::Vector<
        typename IDL::SequenceStorageType,
        0,
        WTF::CrashOnOverflow,
        16,
        MimallocMalloc>>;
}

template<typename IDL>
struct IDLArray : Detail::IDLMimallocSequence<IDL> {
    using Base = Detail::IDLMimallocSequence<IDL>;
};

template<typename T, typename RefDerefTraits = WTF::DefaultRefDerefTraits<T>>
struct IDLBunInterface : WebCore::IDLType<WTF::RefPtr<T, WTF::RawPtrTraits<T>, RefDerefTraits>> {
    using NullableType = WTF::RefPtr<T, WTF::RawPtrTraits<T>, RefDerefTraits>;
    using NullableInnerParameterType = NullableType;

    static inline std::nullptr_t nullValue() { return nullptr; }
    template<typename U> static inline bool isNullValue(U&& value) { return !value; }
    template<typename U> static inline U&& extractValueFromNullable(U&& value)
    {
        return std::forward<U>(value);
    }
};

struct IDLArrayBufferRef : IDLBunInterface<JSC::ArrayBuffer> {};

// Defined in BunIDLConvertBlob.h
struct IDLBlobRef;

}
