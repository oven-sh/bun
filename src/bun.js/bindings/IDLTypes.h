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

#include "StringAdaptors.h"
#include <JavaScriptCore/HandleTypes.h>
#include <JavaScriptCore/Strong.h>
#include <type_traits>
#include <variant>
#include <wtf/Brigand.h>
#include <wtf/Markable.h>
#include <wtf/StdLibExtras.h>
#include <wtf/URL.h>
#include <wtf/WallTime.h>

#if ENABLE(WEBGL)
#include "WebGLAny.h"
#endif

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

#if ENABLE(WEBGL)
class WebGLExtension;
#endif

template<typename T>
struct IDLType {
    using ImplementationType = T;
    using StorageType = T;
    using SequenceStorageType = T;

    using ParameterType = T;
    using NullableParameterType = std::optional<ImplementationType>;

    using InnerParameterType = T;
    using NullableInnerParameterType = std::optional<ImplementationType>;

    using NullableType = std::optional<ImplementationType>;
    static NullableType nullValue() { return std::nullopt; }
    static bool isNullValue(const NullableType& value) { return !value; }
    static ImplementationType extractValueFromNullable(const NullableType& value) { return value.value(); }
    static ImplementationType extractValueFromNullable(NullableType&& value) { return std::move(value.value()); }

    template<typename Traits> using NullableTypeWithLessPadding = Markable<ImplementationType, Traits>;
    template<typename Traits>
    static NullableTypeWithLessPadding<Traits> nullValue() { return std::nullopt; }
    template<typename Traits>
    static bool isNullType(const NullableTypeWithLessPadding<Traits>& value) { return !value; }
    template<typename Traits>
    static ImplementationType extractValueFromNullable(const NullableTypeWithLessPadding<Traits>& value) { return value.value(); }
    template<typename Traits>
    static ImplementationType extractValueFromNullable(NullableTypeWithLessPadding<Traits>&& value) { return std::move(value.value()); }
};

// IDLUnsupportedType is a special type that serves as a base class for currently unsupported types.
struct IDLUnsupportedType : IDLType<void> {
};

// IDLNull is a special type for use as a subtype in an IDLUnion that is nullable.
struct IDLNull : IDLType<std::nullptr_t> {
};

// See also: Bun::IDLRawAny, Bun::Bindgen::IDLStrongAny
struct IDLAny : IDLType<JSC::Strong<JSC::Unknown>> {
    // SequenceStorageType must be left as JSC::Strong<JSC::Unknown>; otherwise
    // IDLSequence<IDLAny> would yield a Vector<JSC::JSValue>, whose contents
    // are invisible to the GC.
    // [do not uncomment] using SequenceStorageType = JSC::JSValue;
    using ParameterType = JSC::JSValue;
    using NullableParameterType = JSC::JSValue;

    using NullableType = JSC::Strong<JSC::Unknown>;
    static inline std::nullptr_t nullValue() { return nullptr; }
    template<typename U> static inline bool isNullValue(U&& value) { return !value; }
    template<typename U> static inline U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

struct IDLUndefined : IDLType<void> {
};

struct IDLBoolean : IDLType<bool> {
};

template<typename NumericType> struct IDLNumber : IDLType<NumericType> {
};

template<typename IntegerType> struct IDLInteger : IDLNumber<IntegerType> {
};
struct IDLByte : IDLInteger<int8_t> {
};
struct IDLOctet : IDLInteger<uint8_t> {
};
struct IDLShort : IDLInteger<int16_t> {
};
struct IDLUnsignedShort : IDLInteger<uint16_t> {
};
struct IDLLong : IDLInteger<int32_t> {
};
struct IDLUnsignedLong : IDLInteger<uint32_t> {
};
struct IDLLongLong : IDLInteger<int64_t> {
};
struct IDLUnsignedLongLong : IDLInteger<uint64_t> {
};

template<typename T> struct IDLClampAdaptor : IDLInteger<typename T::ImplementationType> {
    using InnerType = T;
};

template<typename T> struct IDLEnforceRangeAdaptor : IDLInteger<typename T::ImplementationType> {
    using InnerType = T;
};

template<typename FloatingPointType> struct IDLFloatingPoint : IDLNumber<FloatingPointType> {
};
struct IDLFloat : IDLFloatingPoint<float> {
};
struct IDLUnrestrictedFloat : IDLFloatingPoint<float> {
};
struct IDLDouble : IDLFloatingPoint<double> {
};
struct IDLUnrestrictedDouble : IDLFloatingPoint<double> {
};

template<typename StringType> struct IDLString : IDLType<StringType> {
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
struct IDLDOMString : IDLString<String> {
};
struct IDLByteString : IDLString<String> {
};
struct IDLUSVString : IDLString<String> {
};

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

    static inline NullableType nullValue() { return {}; }
    template<typename U> static inline bool isNullValue(U&& value) { return !value; }
    template<typename U> static inline U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

template<typename T> struct IDLWrapper : IDLType<RefPtr<T>> {
    using RawType = T;

    using StorageType = Ref<T>;

    using ParameterType = T&;
    using NullableParameterType = T*;

    using InnerParameterType = Ref<T>;
    using NullableInnerParameterType = RefPtr<T>;

    using NullableType = RefPtr<T>;
    static inline std::nullptr_t nullValue() { return nullptr; }
    template<typename U> static inline bool isNullValue(U&& value) { return !value; }
    template<typename U> static inline U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

template<typename T> struct IDLInterface : IDLWrapper<T> {
};
template<typename T> struct IDLCallbackInterface : IDLWrapper<T> {
};
template<typename T> struct IDLCallbackFunction : IDLWrapper<T> {
};

template<typename T> struct IDLDictionary : IDLType<T> {
    using ParameterType = const T&;
    using NullableParameterType = const T&;
};

template<typename T> struct IDLEnumeration : IDLType<T> {
};

template<typename T> struct IDLNullable : IDLType<typename T::NullableType> {
    using InnerType = T;

    using ParameterType = typename T::NullableParameterType;
    using NullableParameterType = typename T::NullableParameterType;

    using InnerParameterType = typename T::NullableInnerParameterType;
    using NullableInnerParameterType = typename T::NullableInnerParameterType;

    using NullableType = typename T::NullableType;
    static inline auto nullValue() -> decltype(T::nullValue()) { return T::nullValue(); }
    template<typename U> static inline bool isNullValue(U&& value) { return T::isNullValue(std::forward<U>(value)); }
    template<typename U> static inline auto extractValueFromNullable(U&& value) -> decltype(T::extractValueFromNullable(std::forward<U>(value))) { return T::extractValueFromNullable(std::forward<U>(value)); }
};

// Like `IDLNullable`, but does not permit `null`, only `undefined`.
template<typename T> struct IDLOptional : IDLNullable<T> {
};

template<typename T, typename VectorType = Vector<typename T::SequenceStorageType>>
struct IDLSequence : IDLType<VectorType> {
    using InnerType = T;

    using ParameterType = const VectorType&;
    using NullableParameterType = const std::optional<VectorType>&;
};

template<typename T> struct IDLFrozenArray : IDLType<Vector<typename T::SequenceStorageType>> {
    using InnerType = T;

    using ParameterType = const Vector<typename T::SequenceStorageType>&;
    using NullableParameterType = const std::optional<Vector<typename T::SequenceStorageType>>&;
};

template<typename K, typename V> struct IDLRecord : IDLType<Vector<KeyValuePair<typename K::ImplementationType, typename V::ImplementationType>>> {
    using KeyType = K;
    using ValueType = V;

    using ParameterType = const Vector<KeyValuePair<typename K::ImplementationType, typename V::ImplementationType>>&;
    using NullableParameterType = const std::optional<Vector<KeyValuePair<typename K::ImplementationType, typename V::ImplementationType>>>&;
};

template<typename T> struct IDLPromise : IDLWrapper<DOMPromise> {
    using InnerType = T;
};

struct IDLError : IDLUnsupportedType {
};
struct IDLDOMException : IDLUnsupportedType {
};

template<typename... Ts>
struct IDLUnion : IDLType<std::variant<typename Ts::ImplementationType...>> {
    using TypeList = brigand::list<Ts...>;

    // If `SequenceStorageType` and `ImplementationType` are different for any
    // type in `Ts`, this union should not be allowed to be stored in a
    // sequence. Sequence elements are stored on the heap (in a `Vector`), so
    // if `SequenceStorageType` and `ImplementationType` differ for some type,
    // this is an indication that the `ImplementationType` should not be stored
    // on the heap (e.g., because it is or contains a raw `JSValue`). When this
    // is the case, we indicate that the union itself should not be stored on
    // the heap by defining its `SequenceStorageType` as void.
    //
    // Note that we cannot define `SequenceStorageType` as
    // `std::variant<Ts::SequenceStorageType...>`, as this would cause
    // sequence conversion to fail to compile, because
    // `std::variant<Ts::ImplementationType...>` is not convertible to
    // `std::variant<Ts::SequenceStorageType...>`.
    //
    // A potential avenue for future work would be to extend the IDL type
    // traits interface to allow defining custom conversions from
    // `ImplementationType` to `SequenceStorageType`, and to properly propagate
    // `SequenceStorageType` in other types like `IDLDictionary`; however, one
    // should keep in mind that some types may still disallow heap storage
    // entirely by defining `SequenceStorageType` as void.
    using SequenceStorageType = std::conditional_t<
        (std::is_same_v<typename Ts::SequenceStorageType, typename Ts::ImplementationType> && ...),
        std::variant<typename Ts::ImplementationType...>,
        void>;
    using ParameterType = const std::variant<typename Ts::ImplementationType...>&;
    using NullableParameterType = const std::optional<std::variant<typename Ts::ImplementationType...>>&;
};

template<typename T> struct IDLBufferSource : IDLWrapper<T> {
};

struct IDLArrayBuffer : IDLBufferSource<JSC::ArrayBuffer> {
};
// NOTE: WebIDL defines ArrayBufferView as an IDL union of all the TypedArray types.
//       and DataView. For convience in our implementation, we give it a distinct
//       type that maps to the shared based class of all those classes.
struct IDLArrayBufferView : IDLBufferSource<JSC::ArrayBufferView> {
};
struct IDLDataView : IDLBufferSource<JSC::DataView> {
};

template<typename T> struct IDLTypedArray : IDLBufferSource<T> {
};
// NOTE: The specific typed array types are IDLTypedArray specialized on the typed array
//       implementation type, e.g. IDLFloat64Array is IDLTypedArray<JSC::Float64Array>

// Non-WebIDL extensions

struct IDLDate : IDLType<WallTime> {
    using NullableType = WallTime;
    static WallTime nullValue() { return WallTime::nan(); }
    static bool isNullValue(WallTime value) { return value.isNaN(); }
    static WallTime extractValueFromNullable(WallTime value) { return value; }
};

struct IDLJSON : IDLType<String> {
    using ParameterType = const String&;
    using NullableParameterType = const String&;

    using NullableType = String;
    static String nullValue() { return String(); }
    static bool isNullValue(const String& value) { return value.isNull(); }
    template<typename U> static U&& extractValueFromNullable(U&& value) { return std::forward<U>(value); }
};

struct IDLScheduledAction : IDLType<std::unique_ptr<ScheduledAction>> {
};
template<typename T> struct IDLSerializedScriptValue : IDLWrapper<T> {
};
template<typename T> struct IDLEventListener : IDLWrapper<T> {
};

struct IDLIDBKey : IDLWrapper<IDBKey> {
};
struct IDLIDBKeyData : IDLWrapper<IDBKeyData> {
};
struct IDLIDBValue : IDLWrapper<IDBValue> {
};

#if ENABLE(WEBGL)
struct IDLWebGLAny : IDLType<WebGLAny> {
};
struct IDLWebGLExtension : IDLWrapper<WebGLExtension> {
};
#endif

// Helper predicates

template<typename T>
struct IsIDLInterface : public std::integral_constant<bool, WTF::IsTemplate<T, IDLInterface>::value> {
};

template<typename T>
struct IsIDLDictionary : public std::integral_constant<bool, WTF::IsTemplate<T, IDLDictionary>::value> {
};

template<typename T>
struct IsIDLEnumeration : public std::integral_constant<bool, WTF::IsTemplate<T, IDLEnumeration>::value> {
};

template<typename T>
struct IsIDLSequence : public std::integral_constant<bool, WTF::IsTemplate<T, IDLSequence>::value> {
};

template<typename T>
struct IsIDLFrozenArray : public std::integral_constant<bool, WTF::IsTemplate<T, IDLFrozenArray>::value> {
};

template<typename T>
struct IsIDLRecord : public std::integral_constant<bool, WTF::IsTemplate<T, IDLRecord>::value> {
};

template<typename T>
struct IsIDLString : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLString, T>::value> {
};

template<typename T>
struct IsIDLStringOrEnumeration : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLString, T>::value || WTF::IsTemplate<T, IDLEnumeration>::value> {
};

template<typename T>
struct IsIDLNumber : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLNumber, T>::value> {
};

template<typename T>
struct IsIDLInteger : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLInteger, T>::value> {
};

template<typename T>
struct IsIDLFloatingPoint : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLFloatingPoint, T>::value> {
};

template<typename T>
struct IsIDLTypedArray : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLTypedArray, T>::value> {
};

template<typename T>
struct IsIDLTypedArrayAllowShared : public std::integral_constant<bool, WTF::IsBaseOfTemplate<IDLTypedArray, T>::value && WTF::IsBaseOfTemplate<IDLAllowSharedAdaptor, T>::value> {
};

template<typename T>
struct IsIDLArrayBuffer : public std::integral_constant<bool, std::is_base_of<IDLArrayBuffer, T>::value> {
};

template<typename T>
struct IsIDLArrayBufferView : public std::integral_constant<bool, std::is_base_of<IDLArrayBufferView, T>::value> {
};

template<typename T>
struct IsIDLArrayBufferAllowShared : public std::integral_constant<bool, std::is_base_of<IDLAllowSharedAdaptor<IDLArrayBuffer>, T>::value> {
};

template<typename T>
struct IsIDLArrayBufferViewAllowShared : public std::integral_constant<bool, std::is_base_of<IDLAllowSharedAdaptor<IDLArrayBufferView>, T>::value> {
};

} // namespace WebCore
