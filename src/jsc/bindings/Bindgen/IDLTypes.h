#pragma once
#include "Bindgen/JSStringUTF8View.h"
// WebCore's. In quotes it would be this file.
#include <IDLTypes.h>
#include <concepts>
#include <cstddef>
#include <span>
#include <wtf/Vector.h>

namespace Bun {
struct MimallocMalloc;

// Like `WebCore::IDLSequence`, but the caller picks the container.
template<typename IDL, typename VectorType>
struct IDLSequenceWithStorage : WebCore::IDLType<VectorType> {
    using InnerType = IDL;
    using ParameterType = const VectorType&;
    using NullableParameterType = const std::optional<VectorType>&;
};
}

namespace Bun::Bindgen {

// Like `IDLAny`, but always stored as a raw `JSValue`. This should only be
// used in contexts where the `JSValue` will be stored on the stack.
struct IDLRawAny : WebCore::IDLType<JSC::JSValue> {
    // Storage in a sequence is explicitly unsupported, as this would create a
    // `Vector<JSValue>`, whose contents are invisible to the GC.
    using SequenceStorageType = void;
};

// For use in unions, to represent a nullable union.
struct IDLStrictNull : WebCore::IDLType<std::nullptr_t> {};

// Treats all falsy values as null.
template<typename IDL>
struct IDLFalsyAsNull : WebCore::IDLNullable<IDL> {};

template<std::integral T>
struct IDLStrictInteger : WebCore::IDLInteger<T> {};
struct IDLStrictDouble : WebCore::IDLUnrestrictedDouble {};
struct IDLStrictBoolean : WebCore::IDLBoolean {};
struct IDLStrictString : WebCore::IDLDOMString {};

// Converts to a number first.
template<std::integral T>
struct IDLLooseInteger : IDLStrictInteger<T> {};

namespace Detail {
template<typename IDL>
using IDLMimallocSequence = IDLSequenceWithStorage<
    IDL,
    WTF::Vector<
        typename IDL::SequenceStorageType,
        0,
        WTF::CrashOnOverflow,
        16,
        Bun::MimallocMalloc>>;
}

template<typename IDL>
struct IDLArray : Detail::IDLMimallocSequence<IDL> {
    using Base = Detail::IDLMimallocSequence<IDL>;
};

template<typename T, typename RefDerefTraits = WTF::DefaultRefDerefTraits<T>>
struct IDLRef : WebCore::IDLType<WTF::RefPtr<T, WTF::RawPtrTraits<T>, RefDerefTraits>> {
    using NullableType = WTF::RefPtr<T, WTF::RawPtrTraits<T>, RefDerefTraits>;
    using NullableInnerParameterType = NullableType;
    using NullableConversionResultType = NullableType;

    static inline std::nullptr_t nullValue() { return nullptr; }
};

struct IDLArrayBufferRef : IDLRef<JSC::ArrayBuffer> {};

// Defined in IDLConvertBlob.h
struct IDLBlobRef;

// A dictionary that holds a raw `JSValue` or a `JSStringUTF8View`. Its struct is WTF_FORBID_HEAP_ALLOCATION.
template<typename T>
struct IDLStackOnlyDictionary : WebCore::IDLType<T> {
    using SequenceStorageType = void;
    using ParameterType = const T&;
    using NullableParameterType = const T&;
};

// A generated union: a struct with a tag and a member for each alternative, so that the chosen one is converted where it stays. A large one is a std::optional, made when chosen.
template<typename T>
struct IDLTaggedUnion : WebCore::IDLType<T> {};

// A string or a `String` object, which is what `JSValue::is_string` in Rust accepts.
struct IDLStrictUTF8String : WebCore::IDLType<JSStringUTF8View> {
    using SequenceStorageType = void;
    using NullableType = JSStringUTF8View;
    using NullableInnerParameterType = JSStringUTF8View;
    using NullableConversionResultType = JSStringUTF8View;
    static JSStringUTF8View nullValue() { return {}; }
};
// `ToString`.
struct IDLLooseUTF8String : IDLStrictUTF8String {};
// The values IDLStrictUTF8String takes, as the WTF::String.
struct IDLStrictStringOrStringObject : WebCore::IDLDOMString {};

// The bytes of a BufferSource that is not shared. Valid while the argument is alive and no JavaScript runs.
struct IDLBufferSourceBytes : WebCore::IDLType<std::span<const uint8_t>> {
    using SequenceStorageType = void;
    using NullableType = std::span<const uint8_t>;
    using NullableInnerParameterType = std::span<const uint8_t>;
    using NullableConversionResultType = std::span<const uint8_t>;
    static NullableType nullValue() { return {}; }
};

// The same values, as the `JSValue` itself. See IDLRawAny.
struct IDLRawBufferSource : WebCore::IDLType<JSC::JSValue> {
    using SequenceStorageType = void;
};

// An instance of a generated class, as the cell itself. The caller's frame keeps it alive.
template<typename JSClass>
struct IDLRawInterface : WebCore::IDLType<JSClass*> {
    using SequenceStorageType = void;
    using NullableType = JSClass*;
    using NullableInnerParameterType = JSClass*;
    using NullableConversionResultType = JSClass*;
    static JSClass* nullValue() { return nullptr; }
};

}
