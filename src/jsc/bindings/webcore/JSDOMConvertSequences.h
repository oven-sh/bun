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
#include <array>
#include <limits>
#include <type_traits>
#include "BunIDLConvertBase.h"

namespace WebCore {

namespace Detail {

template<typename IDLType, typename VectorType>
struct SequenceTraits;

template<typename IDLType,
    size_t inlineCapacity,
    typename OverflowHandler,
    size_t minCapacity,
    typename Malloc>
struct SequenceTraits<
    IDLType,
    Vector<
        typename IDLType::SequenceStorageType,
        inlineCapacity,
        OverflowHandler,
        minCapacity,
        Malloc>> {

    using VectorType = Vector<
        typename IDLType::SequenceStorageType,
        inlineCapacity,
        OverflowHandler,
        minCapacity,
        Malloc>;

    static void reserveExact(
        JSC::JSGlobalObject& lexicalGlobalObject,
        VectorType& sequence,
        size_t size)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!sequence.tryReserveCapacity(size)) {
            // FIXME: Is the right exception to throw?
            throwTypeError(&lexicalGlobalObject, scope);
            return;
        }
    }

    template<typename T>
    static void append(
        JSC::JSGlobalObject& lexicalGlobalObject,
        VectorType& sequence,
        size_t index,
        T&& element)
    {
        ASSERT(index == sequence.size());
        if constexpr (std::is_same_v<std::decay_t<T>, JSC::JSValue>) {
            // `JSValue` should not be stored on the heap.
            sequence.append(JSC::Strong { JSC::getVM(&lexicalGlobalObject), element });
        } else {
            sequence.append(std::forward<T>(element));
        }
    }
};

template<typename IDLType, size_t arraySize>
struct SequenceTraits<IDLType, std::array<typename IDLType::ImplementationType, arraySize>> {
    using VectorType = std::array<typename IDLType::ImplementationType, arraySize>;

    static void reserveExact(
        JSC::JSGlobalObject& lexicalGlobalObject,
        VectorType& sequence,
        size_t size)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (size != arraySize) {
            throwTypeError(&lexicalGlobalObject, scope);
        }
    }

    template<typename T>
    static void append(
        JSC::JSGlobalObject& lexicalGlobalObject,
        VectorType& sequence,
        size_t index,
        T&& element)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (index >= arraySize) {
            throwTypeError(&lexicalGlobalObject, scope);
        }
        sequence[index] = std::forward<T>(element);
    }
};

template<typename IDLType, typename VectorType = Vector<typename IDLType::SequenceStorageType>>
struct GenericSequenceConverter {
    using Traits = SequenceTraits<IDLType, VectorType>;
    using ReturnType = Traits::VectorType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, Ctx& ctx)
    {
        return convert(lexicalGlobalObject, object, ReturnType(), ctx);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object)
    {
        auto ctx = Bun::DefaultConversionContext {};
        return convert(lexicalGlobalObject, object, ctx);
    }

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, ReturnType&& result, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        size_t index = 0;
        auto elementCtx = ctx.contextForElement();
        forEachInIterable(&lexicalGlobalObject, object, [&result, &index, &elementCtx](JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            // auto convertedValue = Converter<IDLType>::convert(*lexicalGlobalObject, nextValue);
            auto convertedValue = Bun::convertIDL<IDLType>(*lexicalGlobalObject, nextValue, elementCtx);
            RETURN_IF_EXCEPTION(scope, );
            Traits::append(*lexicalGlobalObject, result, index++, WTF::move(convertedValue));
            RETURN_IF_EXCEPTION(scope, );
        });

        RETURN_IF_EXCEPTION(scope, {});
        // This could be the case if `VectorType` is `std::array`.
        if (index != result.size()) {
            throwTypeError(&lexicalGlobalObject, scope);
        }
        return WTF::move(result);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, ReturnType&& result)
    {
        auto ctx = Bun::DefaultConversionContext {};
        return convert(lexicalGlobalObject, object, WTF::move(result), ctx);
    }

    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        ReturnType result;
        size_t index = 0;
        forEachInIterable(&lexicalGlobalObject, object, [&result, &index, &exceptionThrower](JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto convertedValue = Converter<IDLType>::convert(*lexicalGlobalObject, nextValue, std::forward<ExceptionThrower>(exceptionThrower));
            RETURN_IF_EXCEPTION(scope, );
            Traits::append(*lexicalGlobalObject, result, index++, WTF::move(convertedValue));
            RETURN_IF_EXCEPTION(scope, );
        });

        RETURN_IF_EXCEPTION(scope, {});
        // This could be the case if `VectorType` is `std::array`.
        if (index != result.size()) {
            throwTypeError(&lexicalGlobalObject, scope);
        }
        return WTF::move(result);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return convert(lexicalGlobalObject, object, method, ReturnType());
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method, ReturnType&& result)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        size_t index = 0;
        forEachInIterable(lexicalGlobalObject, object, method, [&result, &index](JSC::VM& vm, JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, nextValue);
            RETURN_IF_EXCEPTION(scope, );
            Traits::append(lexicalGlobalObject, result, index++, WTF::move(convertedValue));
            RETURN_IF_EXCEPTION(scope, );
        });

        RETURN_IF_EXCEPTION(scope, {});
        // This could be the case if `VectorType` is `std::array`.
        if (index != result.size()) {
            throwTypeError(&lexicalGlobalObject, scope);
        }
        return WTF::move(result);
    }
};

template<typename IDLType, typename VectorType = Vector<typename IDLType::SequenceStorageType>>
struct SequenceConverter {
    using Traits = SequenceTraits<IDLType, VectorType>;
    using GenericConverter = GenericSequenceConverter<IDLType, VectorType>;
    using ReturnType = typename GenericConverter::ReturnType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSArray* array, Ctx& ctx)
    {
        auto& vm = lexicalGlobalObject.vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        unsigned length = array->length();

        ReturnType result;
        Traits::reserveExact(lexicalGlobalObject, result, length);
        RETURN_IF_EXCEPTION(scope, {});

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;

        auto elementCtx = ctx.contextForElement();
        if (indexingType == JSC::ContiguousShape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguous().at(array, i).get();
                if (!indexValue)
                    indexValue = JSC::jsUndefined();

                // auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, indexValue);
                auto convertedValue = Bun::convertIDL<IDLType>(lexicalGlobalObject, indexValue, elementCtx);
                RETURN_IF_EXCEPTION(scope, {});
                Traits::append(lexicalGlobalObject, result, i, WTF::move(convertedValue));
            }
            return result;
        }

        for (unsigned i = 0; i < length; i++) {
            auto indexValue = array->getDirectIndex(&lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(scope, {});

            if (!indexValue)
                indexValue = JSC::jsUndefined();

            // auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, indexValue);
            auto convertedValue = Bun::convertIDL<IDLType>(lexicalGlobalObject, indexValue, elementCtx);
            RETURN_IF_EXCEPTION(scope, {});
            Traits::append(lexicalGlobalObject, result, i, WTF::move(convertedValue));
        }
        return result;
    }

    static ReturnType convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSArray* array)
    {
        auto ctx = Bun::DefaultConversionContext {};
        return convertArray(lexicalGlobalObject, array, ctx);
    }

    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static ReturnType convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSArray* array, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto& vm = lexicalGlobalObject.vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        unsigned length = array->length();

        ReturnType result;
        Traits::reserveExact(lexicalGlobalObject, result, length);
        RETURN_IF_EXCEPTION(scope, {});

        JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;

        if (indexingType == JSC::ContiguousShape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguous().at(array, i).get();
                if (!indexValue)
                    indexValue = JSC::jsUndefined();

                auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, indexValue, std::forward<ExceptionThrower>(exceptionThrower));
                RETURN_IF_EXCEPTION(scope, {});
                Traits::append(lexicalGlobalObject, result, i, WTF::move(convertedValue));
                RETURN_IF_EXCEPTION(scope, {});
            }
            return result;
        }

        for (unsigned i = 0; i < length; i++) {
            auto indexValue = array->getDirectIndex(&lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(scope, {});

            if (!indexValue)
                indexValue = JSC::jsUndefined();

            auto convertedValue = Converter<IDLType>::convert(lexicalGlobalObject, indexValue, std::forward<ExceptionThrower>(exceptionThrower));
            RETURN_IF_EXCEPTION(scope, {});
            Traits::append(lexicalGlobalObject, result, i, WTF::move(convertedValue));
            RETURN_IF_EXCEPTION(scope, {});
        }
        return result;
    }

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convertObject(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (Converter<IDLType>::conversionHasSideEffects)
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object, ctx)));

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object, ctx)));

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object, ctx)));

        RELEASE_AND_RETURN(scope, (convertArray(lexicalGlobalObject, array, ctx)));
    }

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (auto* object = value.getObject()) {
            RELEASE_AND_RETURN(scope, (convertObject(lexicalGlobalObject, object, ctx)));
        }
        ctx.throwTypeMustBe(lexicalGlobalObject, scope, "a sequence"_s);
        return {};
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ASCIILiteral functionName = {}, ASCIILiteral argumentName = {})
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (auto* object = value.getObject()) {
            auto ctx = Bun::DefaultConversionContext {};
            RELEASE_AND_RETURN(scope, (convertObject(lexicalGlobalObject, object, ctx)));
        }
        throwSequenceTypeError(lexicalGlobalObject, scope, functionName, argumentName);
        return {};
    }

    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject,
        JSC::JSValue value,
        ExceptionThrower&& exceptionThrower = ExceptionThrower(),
        ASCIILiteral functionName = {}, ASCIILiteral argumentName = {})
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            throwSequenceTypeError(lexicalGlobalObject, scope, functionName, argumentName);
            return {};
        }

        JSC::JSObject* object = JSC::asObject(value);
        if (Converter<IDLType>::conversionHasSideEffects)
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object, std::forward<ExceptionThrower>(exceptionThrower))));

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object, std::forward<ExceptionThrower>(exceptionThrower))));

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            RELEASE_AND_RETURN(scope, (GenericConverter::convert(lexicalGlobalObject, object, std::forward<ExceptionThrower>(exceptionThrower))));

        RELEASE_AND_RETURN(scope, (convertArray(lexicalGlobalObject, array, std::forward<ExceptionThrower>(exceptionThrower))));
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

}

template<typename T, typename VectorType>
struct Converter<IDLSequence<T, VectorType>> : DefaultConverter<IDLSequence<T, VectorType>> {
    using ReturnType = typename Detail::SequenceConverter<T, VectorType>::ReturnType;

    static constexpr bool takesContext = true;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        return Detail::SequenceConverter<T, VectorType>::convert(lexicalGlobalObject, value, ctx);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ASCIILiteral functionName = {}, ASCIILiteral argumentName = {})
    {
        return Detail::SequenceConverter<T, VectorType>::convert(lexicalGlobalObject, value, functionName, argumentName);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, JSC::JSValue method)
    {
        return Detail::SequenceConverter<T, VectorType>::convert(lexicalGlobalObject, object, method);
    }

    template<typename ExceptionThrower> static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower, ASCIILiteral functionName = {}, ASCIILiteral argumentName = {})
    {
        return Detail::SequenceConverter<T, VectorType>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower), functionName, argumentName);
    }
};

template<typename T> struct JSConverter<IDLSequence<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U, size_t inlineCapacity>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const Vector<U, inlineCapacity>& vector)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
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
        auto* array = JSC::constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, array);
    }
};

template<typename T> struct JSConverter<IDLFrozenArray<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U, size_t inlineCapacity>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const Vector<U, inlineCapacity>& vector)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
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
        auto* array = JSC::constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSC::objectConstructorFreeze(&lexicalGlobalObject, array));
    }
};

} // namespace WebCore
