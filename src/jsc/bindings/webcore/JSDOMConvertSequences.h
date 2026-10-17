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

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/ButterflyInlinesLight.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "BunIDLConvertSequence.h"
#include "IDLTypes.h"
#include "JSDOMBindingFacade.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMGlobalObject.h"

namespace WebCore {

namespace Detail {

template<typename IDL>
struct GenericSequenceInnerConverter {
    template<typename Container>
    static void convert(JSC::ThrowScope& scope, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Container& sequence)
    {
        ASSERT(!scope.exception());

        auto convertedValue = WebCore::convert<IDL>(lexicalGlobalObject, value);
        if (convertedValue.hasException(scope)) [[unlikely]]
            return;

        sequence.append(convertedValue.releaseReturnValue());
    }

    // Bun converts an element whose converter takes a conversion context (an enumeration, a nullable, a nested sequence)
    // with the default context: no coercion to string, and "value must be ..." messages.
    template<typename Container>
    static void convertWithDefaultContext(JSC::ThrowScope& scope, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Container& sequence)
    {
        if constexpr (Converter<IDL>::takesContext) {
            ASSERT(!scope.exception());

            auto elementContext = Bun::DefaultConversionContext {}.contextForElement();
            auto convertedValue = Bun::convertIDL<IDL>(lexicalGlobalObject, value, elementContext);
            RETURN_IF_EXCEPTION(scope, void());

            sequence.append(WTF::move(convertedValue));
        } else
            convert(scope, lexicalGlobalObject, value, sequence);
    }
};

template<typename T>
struct GenericSequenceInnerConverter<IDLInterface<T>> {
    using IDL = IDLInterface<T>;

    template<typename Container>
    static void convert(JSC::ThrowScope& scope, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Container& result)
    {
        ASSERT(!scope.exception());

        auto convertedValue = WebCore::convert<IDL>(lexicalGlobalObject, value);
        if (convertedValue.hasException(scope)) [[unlikely]]
            return;

        result.append(Ref { convertedValue.releaseReturnValue() });
    }

    template<typename Container>
    static void convertWithDefaultContext(JSC::ThrowScope& scope, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Container& result)
    {
        convert(scope, lexicalGlobalObject, value, result);
    }
};

template<typename IDL>
struct GenericSequenceConverter {
    using Result = ConversionResult<IDL>;
    using InnerTypeIDL = typename IDL::InnerType;
    using InnerConverter = GenericSequenceInnerConverter<InnerTypeIDL>;
    using SequenceType = Vector<typename InnerTypeIDL::SequenceStorageType, IDL::vectorInlineCapacity>;

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object)
    {
        return convert(lexicalGlobalObject, object, SequenceType());
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, SequenceType&& sequence)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        WebCore::forEachInIterable(&lexicalGlobalObject, object, [&sequence](JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            InnerConverter::convertWithDefaultContext(scope, *lexicalGlobalObject, nextValue, sequence);
        });
        RETURN_IF_EXCEPTION(scope, Result::exception());

        return Result { WTF::move(sequence) };
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return convert(lexicalGlobalObject, object, method, SequenceType());
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method, SequenceType&& sequence)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        WebCore::forEachInIterable(lexicalGlobalObject, object, method, [&sequence](JSC::VM& vm, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            InnerConverter::convert(scope, lexicalGlobalObject, nextValue, sequence);
        });
        RETURN_IF_EXCEPTION(scope, Result::exception());

        return Result { WTF::move(sequence) };
    }
};

// Specialization for numeric types
// FIXME: This is only implemented for the IDLFloatingPointTypes and IDLLong. To add
// support for more numeric types, add an overload of Converter<IDLType>::convert that
// takes a JSGlobalObject, ThrowScope and double as its arguments.
template<typename IDL>
struct NumericSequenceConverterImpl {
    using GenericConverter = GenericSequenceConverter<IDL>;

    using Result = typename GenericConverter::Result;
    using InnerTypeIDL = typename GenericConverter::InnerTypeIDL;
    using InnerConverter = typename GenericConverter::InnerConverter;
    using SequenceType = typename GenericConverter::SequenceType;

    static Result convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope, JSC::JSArray* array, unsigned length, JSC::IndexingType indexingType, SequenceType&& sequence)
    {
        if (indexingType == JSC::Int32Shape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguousInt32().at(array, i).get();
                ASSERT(!indexValue || indexValue.isInt32());
                if (!indexValue)
                    sequence.append(0);
                else
                    sequence.append(indexValue.asInt32());
            }
            return Result { WTF::move(sequence) };
        }

        ASSERT(indexingType == JSC::DoubleShape);
        ASSERT(JSC::Options::allowDoubleShape());
        for (unsigned i = 0; i < length; i++) {
            double doubleValue = array->butterfly()->contiguousDouble().at(array, i);
            if (std::isnan(doubleValue))
                sequence.append(0);
            else {
                auto convertedValue = Converter<InnerTypeIDL>::convert(lexicalGlobalObject, scope, doubleValue);
                if (convertedValue.hasException(scope)) [[unlikely]]
                    return Result::exception();

                sequence.append(convertedValue.releaseReturnValue());
            }
        }
        return Result { WTF::move(sequence) };
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            throwSequenceTypeError(lexicalGlobalObject, scope);
            return Result::exception();
        }

        JSC::JSObject* object = JSC::asObject(value);
        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object));

        JSC::JSArray* array = JSC::asArray(object);
        if (!WebCore::isIteratorProtocolFastAndNonObservable(array))
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object));

        unsigned length = array->length();
        SequenceType sequence;
        // If we're not an int32/double array, it's possible that converting a
        // JSValue to a number could cause the iterator protocol to change, hence,
        // we may need more capacity, or less. In such cases, we use the length
        // as a proxy for the capacity we will most likely need (it's unlikely that
        // a program is written with a valueOf that will augment the iterator protocol).
        // If we are an int32/double array, then length is precisely the capacity we need.
        if (!sequence.tryReserveCapacity(length)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return Result::exception();
        }

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;
        if (indexingType != JSC::Int32Shape && indexingType != JSC::DoubleShape)
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, WTF::move(sequence)));

        return convertArray(lexicalGlobalObject, scope, array, length, indexingType, WTF::move(sequence));
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, method));

        JSC::JSArray* array = JSC::asArray(object);
        if (!WebCore::isIteratorProtocolFastAndNonObservable(array))
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, method));

        unsigned length = array->length();
        SequenceType sequence;
        // If we're not an int32/double array, it's possible that converting a
        // JSValue to a number could cause the iterator protocol to change, hence,
        // we may need more capacity, or less. In such cases, we use the length
        // as a proxy for the capacity we will most likely need (it's unlikely that
        // a program is written with a valueOf that will augment the iterator protocol).
        // If we are an int32/double array, then length is precisely the capacity we need.
        if (!sequence.tryReserveCapacity(length)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return Result::exception();
        }

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;
        if (indexingType != JSC::Int32Shape && indexingType != JSC::DoubleShape)
            RELEASE_AND_RETURN(scope, GenericConverter::convert(lexicalGlobalObject, object, method, WTF::move(sequence)));

        return convertArray(lexicalGlobalObject, scope, array, length, indexingType, WTF::move(sequence));
    }
};

template<typename IDL>
struct SequenceConverterImpl {
    using GenericConverter = GenericSequenceConverter<IDL>;

    using Result = typename GenericConverter::Result;
    using InnerTypeIDL = typename GenericConverter::InnerTypeIDL;
    using InnerConverter = typename GenericConverter::InnerConverter;
    using SequenceType = typename GenericConverter::SequenceType;

    static Result convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSArray* array)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        unsigned length = array->length();

        SequenceType sequence;
        if (!sequence.tryReserveCapacity(length)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return Result::exception();
        }

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;

        if (indexingType == JSC::ContiguousShape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguous().at(array, i).get();
                if (!indexValue)
                    indexValue = JSC::jsUndefined();

                InnerConverter::convertWithDefaultContext(scope, lexicalGlobalObject, indexValue, sequence);
                RETURN_IF_EXCEPTION(scope, Result::exception());
            }
            return Result { WTF::move(sequence) };
        }

        for (unsigned i = 0; i < length; i++) {
            auto indexValue = WebCore::arrayGetDirectIndex(array, &lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(scope, Result::exception());

            if (!indexValue)
                indexValue = JSC::jsUndefined();

            InnerConverter::convertWithDefaultContext(scope, lexicalGlobalObject, indexValue, sequence);
            RETURN_IF_EXCEPTION(scope, Result::exception());
        }
        return Result { WTF::move(sequence) };
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            throwSequenceTypeError(lexicalGlobalObject, scope);
            return Result::exception();
        }

        JSC::JSObject* object = JSC::asObject(value);
        if (Converter<InnerTypeIDL>::conversionHasSideEffects)
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object)));

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object)));

        JSC::JSArray* array = JSC::asArray(object);
        if (!WebCore::isIteratorProtocolFastAndNonObservable(array))
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object)));

        RELEASE_AND_RETURN(scope, (convertArray(lexicalGlobalObject, array)));
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        if (Converter<InnerTypeIDL>::conversionHasSideEffects)
            return GenericConverter::convert(lexicalGlobalObject, object, method);

        if (!JSC::isJSArray(object))
            return GenericConverter::convert(lexicalGlobalObject, object, method);

        JSC::JSArray* array = JSC::asArray(object);
        if (!WebCore::isIteratorProtocolFastAndNonObservable(array))
            return GenericConverter::convert(lexicalGlobalObject, object, method);

        return convertArray(lexicalGlobalObject, array);
    }
};

template<typename IDL, typename ConverterImpl = SequenceConverterImpl<IDL>> struct SequenceConverter : DefaultConverter<IDL> {
    using ReturnType = typename ConverterImpl::SequenceType;
    using Result = typename ConverterImpl::Result;

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return ConverterImpl::convert(lexicalGlobalObject, value);
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return ConverterImpl::convert(lexicalGlobalObject, object, method);
    }

    static constexpr bool takesContext = true;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        return Bun::Detail::SequenceConverter<typename IDL::InnerType, ReturnType>::convert(lexicalGlobalObject, value, ctx);
    }
};

template<typename IDL> struct NumericSequenceConverter : SequenceConverter<IDL, NumericSequenceConverterImpl<IDL>> {};

} // namespace Detail

template<> struct Converter<IDLSequence<IDLLong>> : Detail::NumericSequenceConverter<IDLSequence<IDLLong>> {};
template<> struct Converter<IDLSequence<IDLFloat>> : Detail::NumericSequenceConverter<IDLSequence<IDLFloat>> {};
template<> struct Converter<IDLSequence<IDLUnrestrictedFloat>> : Detail::NumericSequenceConverter<IDLSequence<IDLUnrestrictedFloat>> {};
template<> struct Converter<IDLSequence<IDLDouble>> : Detail::NumericSequenceConverter<IDLSequence<IDLDouble>> {};
template<> struct Converter<IDLSequence<IDLUnrestrictedDouble>> : Detail::NumericSequenceConverter<IDLSequence<IDLUnrestrictedDouble>> {};
template<> struct Converter<IDLFrozenArray<IDLLong>> : Detail::NumericSequenceConverter<IDLFrozenArray<IDLLong>> {};
template<> struct Converter<IDLFrozenArray<IDLFloat>> : Detail::NumericSequenceConverter<IDLFrozenArray<IDLFloat>> {};
template<> struct Converter<IDLFrozenArray<IDLUnrestrictedFloat>> : Detail::NumericSequenceConverter<IDLFrozenArray<IDLUnrestrictedFloat>> {};
template<> struct Converter<IDLFrozenArray<IDLDouble>> : Detail::NumericSequenceConverter<IDLFrozenArray<IDLDouble>> {};
template<> struct Converter<IDLFrozenArray<IDLUnrestrictedDouble>> : Detail::NumericSequenceConverter<IDLFrozenArray<IDLUnrestrictedDouble>> {};

template<typename T, size_t N> struct Converter<IDLSequence<T, N>> : Detail::SequenceConverter<IDLSequence<T, N>> {
    static_assert(!std::is_same_v<T, IDLAny>, "sequence<any> is insecure as input; use a concrete type");
};
template<typename T, size_t N> struct Converter<IDLFrozenArray<T, N>> : Detail::SequenceConverter<IDLFrozenArray<T, N>> {
    static_assert(!std::is_same_v<T, IDLAny>, "FrozenArray<any> is insecure as input; use a concrete type");
};

template<typename T, size_t N> struct JSConverter<IDLSequence<T, N>> {
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
        if (list.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(&lexicalGlobalObject, scope);
            return {};
        }
        RELEASE_AND_RETURN(scope, WebCore::constructArray(&globalObject, list));
    }
};

template<typename T, size_t N> struct JSConverter<IDLFrozenArray<T, N>> {
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
        if (list.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(&lexicalGlobalObject, scope);
            return {};
        }
        auto* array = WebCore::constructArray(&globalObject, list);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSC::objectConstructorFreeze(&lexicalGlobalObject, array));
    }
};

} // namespace WebCore
