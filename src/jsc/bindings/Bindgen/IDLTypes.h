#pragma once
#include "Bindgen/JSBytesView.h"
#include "Bindgen/JSStringUTF8View.h"
// WebCore's. In quotes it would be this file.
#include <IDLTypes.h>
#include <JavaScriptCore/ArgList.h>
#include <concepts>
#include <cstddef>
#include <span>
#include <wtf/Vector.h>

namespace Bun {
struct MimallocMalloc;
}

namespace Bun::Bindgen {

// Like `IDLAny`, but always stored as a raw `JSValue`. This should only be
// used in contexts where the `JSValue` will be stored on the stack.
struct IDLRawAny : WebCore::IDLType<JSC::JSValue> {
    // Storage in a sequence is explicitly unsupported, as this would create a
    // `Vector<JSValue>`, whose contents are invisible to the GC.
    using SequenceStorageType = void;
    using NullableType = JSC::JSValue;
    using NullableInnerParameterType = JSC::JSValue;
    static JSC::JSValue nullValue() { return {}; }
};

// An argument and every one after it, read in place from the call frame.
struct IDLVariadicArguments : WebCore::IDLType<JSC::ArgList> {};

// For use in unions, to represent a nullable union.
struct IDLStrictNull : WebCore::IDLType<std::nullptr_t> {};
struct IDLStrictUndefined : WebCore::IDLType<std::nullptr_t> {};

// Treats all falsy values as null.
template<typename IDL>
struct IDLFalsyAsNull : WebCore::IDLNullable<IDL> {};

// Treats undefined, null and "" as null.
template<typename IDL>
struct IDLEmptyStringAsNull : WebCore::IDLNullable<IDL> {};

// Treats every value that IDL does not take as null.
template<typename IDL>
struct IDLOtherAsNull : WebCore::IDLNullable<IDL> {};

// Treats the empty value, which stands for an argument the call does not have, as null.
template<typename IDL>
struct IDLIfPassed : WebCore::IDLNullable<IDL> {};

enum class AllowBigInt : bool {
    No,
    Yes,
};

template<std::integral T, AllowBigInt = AllowBigInt::No>
struct IDLStrictInteger : WebCore::IDLInteger<T> {};
struct IDLStrictDouble : WebCore::IDLUnrestrictedDouble {};
// A Date is its time value.
struct IDLStrictDoubleOrDate : WebCore::IDLUnrestrictedDouble {};
// Converts to a numeric first. A BigInt is the double nearest to it.
struct IDLLooseDoubleOrBigInt : WebCore::IDLUnrestrictedDouble {};
struct IDLStrictBoolean : WebCore::IDLBoolean {};
struct IDLStrictString : WebCore::IDLDOMString {};

// Converts to a number first, or to a numeric where a BigInt is allowed.
template<std::integral T, AllowBigInt allowBigInt = AllowBigInt::No>
struct IDLLooseInteger : IDLStrictInteger<T, allowBigInt> {};

namespace Detail {
template<typename IDL>
using IDLMimallocSequence = WebCore::IDLSequence<
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

    static inline std::nullptr_t nullValue() { return nullptr; }
};

struct IDLArrayBufferRef : IDLRef<JSC::ArrayBuffer> {};

// Defined in IDLConvertBlob.h
struct IDLBlobRef;

// The pointer that `JSValue::then` in Rust gave a promise reaction as its context: `JSValue::from_ptr_address`, a double.
struct IDLPromisePtr : WebCore::IDLType<void*> {};

// The NativePromiseContext cell that a promise reaction was given as its context, as what `take()` returns.
struct IDLNativePromiseContext : WebCore::IDLType<void*> {};

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
    static JSStringUTF8View nullValue() { return {}; }
};
// `ToString`.
struct IDLLooseUTF8String : IDLStrictUTF8String {};
// The values IDLStrictUTF8String takes, as the WTF::String.
struct IDLStrictStringOrStringObject : WebCore::IDLDOMString {};

// Bytes that C++ passes to Rust. Nothing converts a JS value to it.
struct IDLByteSpan : WebCore::IDLType<std::span<const uint8_t>> {};

// The characters of a string where they are: no reference is taken, and those of a substring stay in its base.
template<bool allowStringObject>
struct IDLStringView : WebCore::IDLType<JSC::GCOwnedDataScope<WTF::StringView>> {
    using SequenceStorageType = void;
};

// `b.bytes`: which values it takes.
struct BytesOptions {
    // Without `ToString`. A string: what IDLStrictUTF8String takes. A buffer: a BufferSource, shared or not.
    bool fromString { false };
    bool fromBuffer { false };
    bool fromBlob { false };
    // `ToString` of anything else, except what `refuseUndefined` and `refuseNull` say. Without it, anything else is refused.
    bool toStringOtherwise { false };
    bool refuseUndefined { false };
    bool refuseNull { false };
    // With `fromString`: only a string, as IDLStrictString.
    bool refuseStringObject { false };
};

// `Sink` is JSBytesView, where a string is its UTF-8, JSBlobOrBufferView, which takes none, or JSBlobOrStringOrBuffer, where it is the WTF::String.
template<typename Sink, BytesOptions>
struct IDLBytes : WebCore::IDLType<Sink> {
    using SequenceStorageType = void;
    using NullableType = Sink;
    using NullableInnerParameterType = Sink;
    static Sink nullValue() { return {}; }
};

// A BufferSource as the `JSValue` itself. See IDLRawAny.
template<bool allowShared>
struct IDLRawBufferSource : IDLRawAny {};

// A function, or a proxy of one, as the `JSValue` itself. See IDLRawAny.
struct IDLRawCallable : IDLRawAny {};

// A string as the cell itself. The caller's frame keeps it alive.
struct IDLRawString : WebCore::IDLType<JSC::JSString*> {
    using SequenceStorageType = void;
    using NullableType = JSC::JSString*;
    using NullableInnerParameterType = JSC::JSString*;
    static JSC::JSString* nullValue() { return nullptr; }
};

// An object as the `JSValue` itself. See IDLRawAny.
struct IDLRawObject : IDLRawAny {};

// An array as the `JSValue` itself. See IDLRawAny.
struct IDLRawArray : IDLRawAny {};

// An instance of a generated class, as the cell itself. The caller's frame keeps it alive.
template<typename JSClass>
struct IDLRawInterface : WebCore::IDLType<JSClass*> {
    using SequenceStorageType = void;
    using NullableType = JSClass*;
    using NullableInnerParameterType = JSClass*;
    static JSClass* nullValue() { return nullptr; }
};

// An instance of a `refCounted` class, as what it wraps. The caller's frame keeps the cell alive.
template<typename JSClass, auto name>
struct IDLWrappedInterface : WebCore::IDLType<void*> {
    using SequenceStorageType = void;
    using NullableType = void*;
    using NullableInnerParameterType = void*;
    static void* nullValue() { return nullptr; }
};

}
