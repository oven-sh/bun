/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <JavaScriptCore/HandleTypes.h>
#include <JavaScriptCore/Strong.h>
#include "BufferSource.h"
#include "JSDOMPromiseDeferredForward.h"
#include "StringAdaptors.h"
#include <wtf/Brigand.h>
#include <wtf/Markable.h>
#include <wtf/URL.h>
#include <wtf/WallTime.h>

namespace JSC {
class ArrayBuffer;
class ArrayBufferView;
class DataView;
class JSValue;
class JSObject;
}

namespace WebCore {

class IDBKey;
class IDBKeyData;
class IDBValue;
class JSWindowProxy;
class DOMPromise;
class ScheduledAction;

template<typename T>
struct IDLType {
    using ImplementationType = T;
    using StorageType = T;
    using SequenceStorageType = T;
    using DictionaryStorageType = T;
    using UnionStorageType = T;
    using CallbackReturnType = T;

    using ConversionResultType = T;
    using NullableConversionResultType = std::optional<T>;

    using ParameterType = T;
    using NullableParameterType = std::optional<ImplementationType>;

    using InnerParameterType = T;
    using NullableInnerParameterType = std::optional<ImplementationType>;

    using NullableType = std::optional<ImplementationType>;
    static constexpr std::nullopt_t nullValue() { return std::nullopt; }
    static bool isNullValue(const NullableType& value) { return !value; }
    static ImplementationType extractValueFromNullable(const NullableType& value) { return value.value(); }

    template<typename Traits> using NullableTypeWithLessPadding = Markable<ImplementationType, Traits>;
    template<typename Traits>
    static NullableTypeWithLessPadding<Traits> nullValue() { return std::nullopt; }
    template<typename Traits>
    static bool isNullType(const NullableTypeWithLessPadding<Traits>& value) { return !value; }
    template<typename Traits>
    static ImplementationType extractValueFromNullable(const NullableTypeWithLessPadding<Traits>& value) { return value.value(); }
};

// IDLUnsupportedType is a special type that serves as a base class for currently unsupported types.
struct IDLUnsupportedType : IDLType<void> {};

// IDLNull is a special type for use as a subtype in an IDLUnion that is nullable.
struct IDLNull : IDLType<std::nullptr_t> {};

struct IDLAny : IDLType<JSC::Strong<JSC::Unknown>> {
    using SequenceStorageType = JSC::JSValue;
    using CallbackReturnType = JSC::JSValue;

    using ParameterType = JSC::JSValue;
    using NullableParameterType = JSC::JSValue;

    using ConversionResultType = JSC::JSValue;
    using NullableConversionResultType = JSC::JSValue;

    using NullableType = JSC::Strong<JSC::Unknown>;
    static constexpr std::nullptr_t nullValue() { return nullptr; }
    template<typename U> static inline bool isNullValue(U&& value) { return !value; }
    template<typename U> static inline U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

struct IDLUndefined : IDLType<std::monostate> {
    using CallbackReturnType = void;
};

struct IDLBoolean : IDLType<bool> {};

template<typename NumericType> struct IDLNumber : IDLType<NumericType> {};

template<typename IntegerType> struct IDLInteger : IDLNumber<IntegerType> {};
struct IDLByte : IDLInteger<int8_t> {};
struct IDLOctet : IDLInteger<uint8_t> {};
struct IDLShort : IDLInteger<int16_t> {};
struct IDLUnsignedShort : IDLInteger<uint16_t> {};
struct IDLLong : IDLInteger<int32_t> {};
struct IDLUnsignedLong : IDLInteger<uint32_t> {};
struct IDLLongLong : IDLInteger<int64_t> {};
struct IDLUnsignedLongLong : IDLInteger<uint64_t> {};

template<typename T> struct IDLClampAdaptor : IDLInteger<typename T::ImplementationType> {
    using InnerType = T;
};

template<typename T> struct IDLEnforceRangeAdaptor : IDLInteger<typename T::ImplementationType> {
    using InnerType = T;
};

template<typename FloatingPointType> struct IDLFloatingPoint : IDLNumber<FloatingPointType> {};
struct IDLFloat : IDLFloatingPoint<float> {};
struct IDLUnrestrictedFloat : IDLFloatingPoint<float> {};
struct IDLDouble : IDLFloatingPoint<double> {};
struct IDLUnrestrictedDouble : IDLFloatingPoint<double> {};

template<typename StringType> struct IDLString : IDLType<StringType> {
    using ConversionResultType = StringType;
    using NullableConversionResultType = StringType;

    using ParameterType = const StringType&;
    using NullableParameterType = const StringType&;

    using NullableType = StringType;
    static StringType nullValue() { return StringType(); }
    static bool isNullValue(const String& value) { return value.isNull(); }
    static bool isNullValue(const AtomString& value) { return value.isNull(); }
    static bool isNullValue(const UncachedString& value) { return value.string.isNull(); }
    static bool isNullValue(const OwnedString& value) { return value.string.isNull(); }
    static bool isNullValue(const URL& value) { return value.isNull(); }
    template<typename U> static U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};
struct IDLDOMString : IDLString<String> {};
struct IDLByteString : IDLString<String> {};
struct IDLUSVString : IDLString<String> {};

template<typename T> struct IDLLegacyNullToEmptyStringAdaptor : IDLString<String> {
    using InnerType = T;
};

template<typename T> struct IDLLegacyNullToEmptyAtomStringAdaptor : IDLString<AtomString> {
    using InnerType = T;
};

template<typename T> struct IDLAtomStringAdaptor : IDLString<AtomString> {
    using InnerType = T;
};

template<typename T> struct IDLRequiresExistingAtomStringAdaptor : IDLString<AtomString> {
    using InnerType = T;
};

template<typename T> struct IDLAllowSharedAdaptor : T {
    using InnerType = T;
};

struct IDLObject : IDLType<JSC::Strong<JSC::JSObject>> {
    using NullableType = JSC::Strong<JSC::JSObject>;

    using ConversionResultType = JSC::Strong<JSC::JSObject>;
    using NullableConversionResultType = JSC::Strong<JSC::JSObject>;

    static inline NullableType nullValue() { return {}; }
    template<typename U> static inline bool isNullValue(U&& value) { return !value; }
    template<typename U> static inline U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

template<typename T> struct IDLWrapper : IDLType<Ref<T>> {
    using RawType = T;

    using CallbackReturnType = Ref<T>;
    using NullableCallbackReturnType = RefPtr<T>;

    using ConversionResultType = std::reference_wrapper<T>;
    using NullableConversionResultType = T*;

    using ParameterType = T&;
    using NullableParameterType = T*;

    using InnerParameterType = Ref<T>;
    using NullableInnerParameterType = RefPtr<T>;

    using NullableType = RefPtr<T>;
    static constexpr std::nullptr_t nullValue() { return nullptr; }

    template<std::derived_from<T> U>
    static constexpr bool isNullValue(const U&) { return false; }
    template<std::derived_from<T> U>
    static constexpr bool isNullValue(const Ref<U>&) { return false; }

    template<std::derived_from<T> U>
    static inline bool isNullValue(const RefPtr<U>& value) { return !value; }
    template<std::derived_from<T> U, typename WeakTraits>
    static inline bool isNullValue(const WeakPtr<U, WeakTraits>& value) { return !value; }
    template<std::derived_from<T> U>
    static inline bool isNullValue(const U* value) { return !value; }

    template<std::derived_from<T> U>
    static inline Ref<U> extractValueFromNullable(Ref<U>&& value) { return value; }
    template<std::derived_from<T> U>
    static inline U& CLANG_POINTER_CONVERSION extractValueFromNullable(Ref<U>& value) { return value; }
    template<std::derived_from<T> U>
    static inline U& CLANG_POINTER_CONVERSION extractValueFromNullable(U& value) { return value; }

    template<std::derived_from<T> U>
    static inline Ref<U> extractValueFromNullable(RefPtr<U>&& value) { return value.releaseNonNull(); }
    template<std::derived_from<T> U>
    static inline U& CLANG_POINTER_CONVERSION extractValueFromNullable(const RefPtr<U>& value) { return *value; }
    template<std::derived_from<T> U, typename WeakTraits>
    static inline Ref<U> extractValueFromNullable(WeakPtr<U, WeakTraits>&& value) { return value.releaseNonNull(); }
    template<std::derived_from<T> U, typename WeakTraits>
    static inline U& CLANG_POINTER_CONVERSION extractValueFromNullable(const WeakPtr<U, WeakTraits>& value) { return *value; }
    template<std::derived_from<T> U>
    static inline U& CLANG_POINTER_CONVERSION extractValueFromNullable(U* value) { return *value; }
};

template<typename T> struct IDLInterface : IDLWrapper<T> {
    using ConversionResultType = Ref<T>;
    using NullableConversionResultType = RefPtr<T>;
};

template<typename T> struct IDLCallbackInterface : IDLWrapper<T> {
    using ConversionResultType = Ref<T>;
    using NullableConversionResultType = RefPtr<T>;

    // FIXME: This is needed to work around unions storing non-nullable callback types using RefPtr rather than Ref<>.
    // See "Support using Ref for callback types in IDL unions" (https://bugs.webkit.org/show_bug.cgi?id=307452).
    using UnionStorageType = RefPtr<T>;
};

template<typename T> struct IDLCallbackFunction : IDLWrapper<T> {
    using ConversionResultType = Ref<T>;
    using NullableConversionResultType = RefPtr<T>;

    // FIXME: This is needed to work around unions storing non-nullable callback types using RefPtr rather than Ref<>.
    // See "Support using Ref for callback types in IDL unions" (https://bugs.webkit.org/show_bug.cgi?id=307452).
    using UnionStorageType = RefPtr<T>;
};

template<typename T> struct IDLDictionary : IDLType<T> {
    using ParameterType = const T&;
    using NullableParameterType = const std::optional<T>&;
};

template<typename T> struct IDLEnumeration : IDLType<T> {};

template<typename T> struct IDLNullableBase : IDLType<typename T::NullableType> {
    using InnerType = T;

    using ConversionResultType = typename T::NullableConversionResultType;
    using NullableConversionResultType = std::optional<ConversionResultType>;

    using ParameterType = typename T::NullableParameterType;
    using NullableParameterType = std::optional<ParameterType>;

    using InnerParameterType = typename T::NullableInnerParameterType;
    using NullableInnerParameterType = std::optional<InnerParameterType>;
};

template<typename T> struct IDLNullable : IDLNullableBase<T> {};

// `IDLOptional` is just like `IDLNullable`, but used in places that where the type is implicitly optional,
// like optional arguments to functions without default values, or non-required members of dictionaries
// without default values.
template<typename T> struct IDLOptional : IDLNullableBase<T> {};

template<typename T, size_t inlineCapacity> struct IDLSequence : IDLType<Vector<typename T::InnerParameterType, inlineCapacity>> {
    using InnerType = T;
    static constexpr size_t vectorInlineCapacity = inlineCapacity;

    using ParameterType = const Vector<typename T::InnerParameterType, inlineCapacity>&;
    using NullableParameterType = const std::optional<Vector<typename T::InnerParameterType, inlineCapacity>>&;
};

template<typename T, size_t inlineCapacity> struct IDLFrozenArray : IDLType<Vector<typename T::InnerParameterType, inlineCapacity>> {
    using InnerType = T;
    static constexpr size_t vectorInlineCapacity = inlineCapacity;

    using ParameterType = const Vector<typename T::InnerParameterType, inlineCapacity>&;
    using NullableParameterType = const std::optional<Vector<typename T::InnerParameterType, inlineCapacity>>&;
};

template<typename K, typename V> struct IDLRecord : IDLType<Vector<KeyValuePair<typename K::InnerParameterType, typename V::InnerParameterType>>> {
    using KeyType = K;
    using ValueType = V;

    using ParameterType = const Vector<KeyValuePair<typename K::InnerParameterType, typename V::InnerParameterType>>&;
    using NullableParameterType = const std::optional<Vector<KeyValuePair<typename K::InnerParameterType, typename V::InnerParameterType>>>&;
};

template<typename T> struct IDLPromise : IDLWrapper<DOMPromise> {
    using InnerType = T;

    using ConversionResultType = Ref<DOMPromise>;
    using NullableConversionResultType = RefPtr<DOMPromise>;
};

template<typename T> struct IDLPromiseIgnoringSuspension : IDLWrapper<DOMPromise> {
    using InnerType = T;

    using ConversionResultType = Ref<DOMPromise>;
    using NullableConversionResultType = RefPtr<DOMPromise>;
};

struct IDLError : IDLUnsupportedType {};
struct IDLDOMException : IDLUnsupportedType {};

template<typename... Ts>
struct IDLUnion : IDLType<Variant<typename Ts::UnionStorageType...>> {
    using TypeList = brigand::list<Ts...>;

    using ParameterType = const Variant<typename Ts::UnionStorageType...>&;
    using NullableParameterType = const std::optional<Variant<typename Ts::UnionStorageType...>>&;
};

template<typename T> struct IDLBufferSourceBase : IDLWrapper<T> {
    using ConversionResultType = Ref<T>;
    using NullableConversionResultType = RefPtr<T>;
};

struct IDLArrayBuffer : IDLBufferSourceBase<JSC::ArrayBuffer> {};
// NOTE: WebIDL defines ArrayBufferView as an IDL union of all the TypedArray types.
//       and DataView. For convenience in our implementation, we give it a distinct
//       type that maps to the shared based class of all those classes.
struct IDLArrayBufferView : IDLBufferSourceBase<JSC::ArrayBufferView> {};
struct IDLDataView : IDLBufferSourceBase<JSC::DataView> {};

template<typename T> struct IDLTypedArray : IDLBufferSourceBase<T> {};
// NOTE: The specific typed array types are IDLTypedArray specialized on the typed array
//       implementation type, e.g. IDLFloat64Array is IDLTypedArray<JSC::Float64Array>

struct IDLBufferSource : IDLType<BufferSource> {};

// Non-WebIDL extensions

struct IDLDate : IDLType<WallTime> {
    using ConversionResultType = WallTime;
    using NullableConversionResultType = WallTime;

    using NullableType = WallTime;
    static WallTime nullValue() { return WallTime::nan(); }
    static bool isNullValue(WallTime value) { return value.isNaN(); }
    static WallTime extractValueFromNullable(WallTime value) { return value; }
};

struct IDLJSON : IDLType<String> {
    using ConversionResultType = String;
    using NullableConversionResultType = String;

    using ParameterType = const String&;
    using NullableParameterType = const String&;

    using NullableType = String;
    static String nullValue() { return String(); }
    static bool isNullValue(const String& value) { return value.isNull(); }
    template<typename U> static U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

template<typename T> struct IDLSerializedScriptValue : IDLWrapper<T> {
    using ConversionResultType = Ref<T>;
    using NullableConversionResultType = RefPtr<T>;
};

template<typename T> struct IDLEventListener : IDLWrapper<T> {
    using ConversionResultType = Ref<T>;
    using NullableConversionResultType = RefPtr<T>;
};

struct IDLIDBKey : IDLInterface<IDBKey> {};
struct IDLIDBKeyData : IDLInterface<IDBKeyData> {};
struct IDLIDBValue : IDLInterface<IDBValue> {};

struct IDLScheduledAction : IDLType<std::unique_ptr<ScheduledAction>> {};

#if ENABLE(WEBGL)
struct IDLWebGLAny;
struct IDLWebGLExtensionAny;
#endif

// Helper predicates

template<typename T>
struct IsIDLInterface : public std::integral_constant<bool, WTF::IsTemplate<T, IDLInterface>::value> {};

template<typename T>
struct IsIDLCallbackFunction : public std::integral_constant<bool, WTF::IsTemplate<T, IDLCallbackFunction>::value> {};

template<typename T>
struct IsIDLDictionary : public std::integral_constant<bool, WTF::IsTemplate<T, IDLDictionary>::value> {};

template<typename T>
struct IsIDLEnumeration : public std::integral_constant<bool, WTF::IsTemplate<T, IDLEnumeration>::value> {};

template<typename T>
struct IsIDLSequence : public std::false_type {};
template<typename T, size_t N>
struct IsIDLSequence<IDLSequence<T, N>> : public std::true_type {};

template<typename T>
struct IsIDLFrozenArray : public std::false_type {};
template<typename T, size_t N>
struct IsIDLFrozenArray<IDLFrozenArray<T, N>> : public std::true_type {};

template<typename T>
struct IsIDLRecord : public std::integral_constant<bool, WTF::IsTemplate<T, IDLRecord>::value> {};

template<typename T>
struct IsIDLString : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLString, T>::value> {};

template<typename T>
struct IsIDLStringOrEnumeration : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLString, T>::value || WTF::IsTemplate<T, IDLEnumeration>::value> {};

template<typename T>
struct IsIDLNumber : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLNumber, T>::value> {};

template<typename T>
struct IsIDLInteger : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLInteger, T>::value> {};

template<typename T>
struct IsIDLFloatingPoint : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLFloatingPoint, T>::value> {};

template<typename T>
struct IsIDLTypedArray : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLTypedArray, T>::value> {};

template<typename T>
struct IsIDLTypedArrayAllowShared : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLTypedArray, T>::value && WTF::IsBaseOfTemplate<IDLAllowSharedAdaptor, T>::value> {};

template<typename T>
struct IsIDLArrayBuffer : public std::integral_constant<bool, std::is_base_of<IDLArrayBuffer, T>::value> {};

template<typename T>
struct IsIDLArrayBufferView : public std::integral_constant<bool, std::is_base_of<IDLArrayBufferView, T>::value> {};

template<typename T>
struct IsIDLArrayBufferAllowShared : public std::integral_constant<bool, std::is_base_of<IDLAllowSharedAdaptor<IDLArrayBuffer>, T>::value> {};

template<typename T>
struct IsIDLArrayBufferViewAllowShared : public std::integral_constant<bool, std::is_base_of<IDLAllowSharedAdaptor<IDLArrayBufferView>, T>::value> {};

} // namespace WebCore
