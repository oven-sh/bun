#pragma once
#include <BunIDLTypes.h>
#include <span>
#include "JSStringUTF8View.h"

namespace Bun::Bindgen {

// Dictionaries that hold a raw `JSValue` or a `JSStringUTF8View` must live on the stack.
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

// The bytes of a BufferSource that is not shared. Valid while the argument is alive and no JavaScript runs.
struct IDLBufferSourceBytes : WebCore::IDLType<std::span<const uint8_t>> {
    using SequenceStorageType = void;
    using NullableType = std::span<const uint8_t>;
    using NullableInnerParameterType = std::span<const uint8_t>;
    static NullableType nullValue() { return {}; }
};

// The same values, as the `JSValue` itself. See Bun::IDLRawAny.
struct IDLRawBufferSource : WebCore::IDLType<JSC::JSValue> {
    using SequenceStorageType = void;
};

// An instance of a generated class, as the cell itself. The caller's frame keeps it alive.
template<typename JSClass>
struct IDLRawInterface : WebCore::IDLType<JSClass*> {
    using SequenceStorageType = void;
    using NullableType = JSClass*;
    using NullableInnerParameterType = JSClass*;
    static JSClass* nullValue() { return nullptr; }
};

}
