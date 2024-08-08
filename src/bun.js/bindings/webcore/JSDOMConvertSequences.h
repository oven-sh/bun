/*
 * Copyright (C) 2016-2022 Apple Inc. All rights reserved.
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

#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace WebCore {

namespace Detail {

template<typename IDLType>
struct GenericSequenceConverter {
    using ReturnType = Vector<typename IDLType::SequenceStorageType>;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object)
    {
        return convert(lexicalGlobalObject, object, ReturnType());
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, ReturnType&& result)
    {
        forEachInIterable(&lexicalGlobalObject, object, [&result](JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto convertedValue = Converter<IDLType>::convert(*lexicalGlobalObject, nextValue);
            if (UNLIKELY(scope.exception()))
                return;
            result.append(WTFMove(convertedValue));
        });
        return WTFMove(result);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return convert(lexicalGlobalObject, object, method, ReturnType());
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method, ReturnType&& result)
    {
        forEachInIterable(lexicalGlobalObject, object, method, [&result](JSC::VM& vm, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, nextValue);
            if (UNLIKELY(scope.exception()))
                return;
            result.append(WTFMove(convertedValue));
        });
        return WTFMove(result);
    }
};

// Specialization for numeric types
// FIXME: This is only implemented for the IDLFloatingPointTypes and IDLLong. To add
// support for more numeric types, add an overload of Converter<IDLType>::convert that
// takes a JSGlobalObject, ThrowScope and double as its arguments.
template<typename IDLType>
struct NumericSequenceConverter {
    using GenericConverter = GenericSequenceConverter<IDLType>;
    using ReturnType = typename GenericConverter::ReturnType;

    static ReturnType convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope, JSC::JSArray* array, unsigned length, JSC::IndexingType indexingType, ReturnType&& result)
    {
        if (indexingType == JSC::Int32Shape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguousInt32().at(array, i).get();
                ASSERT(!indexValue || indexValue.isInt32());
                if (!indexValue)
                    result.append(0);
                else
                    result.append(indexValue.asInt32());
            }
            return WTFMove(result);
        }

        ASSERT(indexingType == JSC::DoubleShape);
        ASSERT(JSC::Options::allowDoubleShape());
        for (unsigned i = 0; i < length; i++) {
            double doubleValue = array->butterfly()->contiguousDouble().at(array, i);
            if (std::isnan(doubleValue))
                result.append(0);
            else {
                auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, scope, doubleValue);
                RETURN_IF_EXCEPTION(scope, {});

                result.append(convertedValue);
            }
        }
        return WTFMove(result);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            throwSequenceTypeError(lexicalGlobalObject, scope);
            return {};
        }

        JSC::JSObject* object = JSC::asObject(value);
        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object));

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object));

        unsigned length = array->length();
        ReturnType result;
        // If we're not an int32/double array, it's possible that converting a
        // JSValue to a number could cause the iterator protocol to change, hence,
        // we may need more capacity, or less. In such cases, we use the length
        // as a proxy for the capacity we will most likely need (it's unlikely that
        // a program is written with a valueOf that will augment the iterator protocol).
        // If we are an int32/double array, then length is precisely the capacity we need.
        if (!result.tryReserveCapacity(length)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return {};
        }

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;
        if (indexingType != JSC::Int32Shape && indexingType != JSC::DoubleShape)
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, WTFMove(result)));

        return convertArray(lexicalGlobalObject, scope, array, length, indexingType, WTFMove(result));
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, method));

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, method));

        unsigned length = array->length();
        ReturnType result;
        // If we're not an int32/double array, it's possible that converting a
        // JSValue to a number could cause the iterator protocol to change, hence,
        // we may need more capacity, or less. In such cases, we use the length
        // as a proxy for the capacity we will most likely need (it's unlikely that
        // a program is written with a valueOf that will augment the iterator protocol).
        // If we are an int32/double array, then length is precisely the capacity we need.
        if (!result.tryReserveCapacity(length)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return {};
        }

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;
        if (indexingType != JSC::Int32Shape && indexingType != JSC::DoubleShape)
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, method, WTFMove(result)));

        return convertArray(lexicalGlobalObject, scope, array, length, indexingType, WTFMove(result));
    }
};

template<typename IDLType>
struct SequenceConverter {
    using GenericConverter = GenericSequenceConverter<IDLType>;
    using ReturnType = typename GenericConverter::ReturnType;

    static ReturnType convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSArray* array)
    {
        auto& vm = lexicalGlobalObject.vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        unsigned length = array->length();

        ReturnType result;
        if (!result.tryReserveCapacity(length)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return {};
        }

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;

        if (indexingType == JSC::ContiguousShape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguous().at(array, i).get();
                if (!indexValue)
                    indexValue = JSC::jsUndefined();

                auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, indexValue);
                RETURN_IF_EXCEPTION(scope, {});

                result.append(convertedValue);
            }
            return result;
        }

        for (unsigned i = 0; i < length; i++) {
            auto indexValue = array->getDirectIndex(&lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(scope, {});

            if (!indexValue)
                indexValue = JSC::jsUndefined();

            auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, indexValue);
            RETURN_IF_EXCEPTION(scope, {});

            result.append(convertedValue);
        }
        return result;
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            throwSequenceTypeError(lexicalGlobalObject, scope);
            return {};
        }

        JSC::JSObject* object = JSC::asObject(value);
        if (Converter<IDLType>::conversionHasSideEffects)
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object)));

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object)));

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object)));

        RELEASE_AND_RETURN(scope, (convertArray(lexicalGlobalObject, array)));
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        if (Converter<IDLType>::conversionHasSideEffects)
            return GenericConverter::convert(lexicalGlobalObject, object, method);

        if (!JSC::isJSArray(object))
            return GenericConverter::convert(lexicalGlobalObject, object, method);

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            return GenericConverter::convert(lexicalGlobalObject, object, method);

        return convertArray(lexicalGlobalObject, array);
    }
};

template<>
struct SequenceConverter<IDLLong> {
    using ReturnType = typename GenericSequenceConverter<IDLLong>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return NumericSequenceConverter<IDLLong>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return NumericSequenceConverter<IDLLong>::convert(lexicalGlobalObject, object, method);
    }
};

template<>
struct SequenceConverter<IDLFloat> {
    using ReturnType = typename GenericSequenceConverter<IDLFloat>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return NumericSequenceConverter<IDLFloat>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return NumericSequenceConverter<IDLFloat>::convert(lexicalGlobalObject, object, method);
    }
};

template<>
struct SequenceConverter<IDLUnrestrictedFloat> {
    using ReturnType = typename GenericSequenceConverter<IDLUnrestrictedFloat>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return NumericSequenceConverter<IDLUnrestrictedFloat>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return NumericSequenceConverter<IDLUnrestrictedFloat>::convert(lexicalGlobalObject, object, method);
    }
};

template<>
struct SequenceConverter<IDLDouble> {
    using ReturnType = typename GenericSequenceConverter<IDLDouble>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return NumericSequenceConverter<IDLDouble>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return NumericSequenceConverter<IDLDouble>::convert(lexicalGlobalObject, object, method);
    }
};

template<>
struct SequenceConverter<IDLUnrestrictedDouble> {
    using ReturnType = typename GenericSequenceConverter<IDLUnrestrictedDouble>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return NumericSequenceConverter<IDLUnrestrictedDouble>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return NumericSequenceConverter<IDLUnrestrictedDouble>::convert(lexicalGlobalObject, object, method);
    }
};

}

template<typename T> struct Converter<IDLSequence<T>> : DefaultConverter<IDLSequence<T>> {
    using ReturnType = typename Detail::SequenceConverter<T>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return Detail::SequenceConverter<T>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return Detail::SequenceConverter<T>::convert(lexicalGlobalObject, object, method);
    }
};

template<typename T> struct JSConverter<IDLSequence<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U, size_t inlineCapacity>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const Vector<U, inlineCapacity>& vector)
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::MarkedArgumentBuffer list;
        list.ensureCapacity(vector.size());
        for (auto& element : vector) {
            auto jsValue = toJS<T>(lexicalGlobalObject, globalObject, element);
            RETURN_IF_EXCEPTION(scope, {});
            list.append(jsValue);
        }
        if (UNLIKELY(list.hasOverflowed())) {
            throwOutOfMemoryError(&lexicalGlobalObject, scope);
            return {};
        }
        RELEASE_AND_RETURN(scope, JSC::constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list));
    }
};

template<typename T> struct Converter<IDLFrozenArray<T>> : DefaultConverter<IDLFrozenArray<T>> {
    using ReturnType = typename Detail::SequenceConverter<T>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return Detail::SequenceConverter<T>::convert(lexicalGlobalObject, value);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return Detail::SequenceConverter<T>::convert(lexicalGlobalObject, object, method);
    }
};

template<typename T> struct JSConverter<IDLFrozenArray<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U, size_t inlineCapacity>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const Vector<U, inlineCapacity>& vector)
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::MarkedArgumentBuffer list;
        list.ensureCapacity(vector.size());
        for (auto& element : vector) {
            auto jsValue = toJS<T>(lexicalGlobalObject, globalObject, element);
            RETURN_IF_EXCEPTION(scope, {});
            list.append(jsValue);
        }
        if (UNLIKELY(list.hasOverflowed())) {
            throwOutOfMemoryError(&lexicalGlobalObject, scope);
            return {};
        }
        auto* array = JSC::constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSC::objectConstructorFreeze(&lexicalGlobalObject, array));
    }
};

} // namespace WebCore
