#pragma once
#include "BunIDLConvertBase.h"
#include "Bindgen/IDLTypes.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <type_traits>

namespace Bun::Detail {

template<typename IDL, typename VectorType>
struct SequenceConverter {
    using ReturnType = VectorType;

    template<typename T>
    static void append(JSC::JSGlobalObject& lexicalGlobalObject, VectorType& sequence, T&& element)
    {
        if constexpr (std::is_same_v<std::decay_t<T>, JSC::JSValue>) {
            // `JSValue` should not be stored on the heap.
            sequence.append(JSC::Strong { JSC::getVM(&lexicalGlobalObject), element });
        } else {
            sequence.append(std::forward<T>(element));
        }
    }

    template<IDLConversionContext Ctx>
    static ReturnType convertIterable(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject* object, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        ReturnType result;
        auto elementCtx = ctx.contextForElement();
        forEachInIterable(&lexicalGlobalObject, object, [&result, &elementCtx](JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue nextValue) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto convertedValue = Bun::convertIDL<IDL>(*lexicalGlobalObject, nextValue, elementCtx);
            RETURN_IF_EXCEPTION(scope, );
            append(*lexicalGlobalObject, result, WTF::move(convertedValue));
        });

        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }

    template<IDLConversionContext Ctx>
    static ReturnType convertArray(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSArray* array, Ctx& ctx)
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

        auto elementCtx = ctx.contextForElement();
        if (indexingType == JSC::ContiguousShape) {
            for (unsigned i = 0; i < length; i++) {
                auto indexValue = array->butterfly()->contiguous().at(array, i).get();
                if (!indexValue)
                    indexValue = JSC::jsUndefined();

                auto convertedValue = Bun::convertIDL<IDL>(lexicalGlobalObject, indexValue, elementCtx);
                RETURN_IF_EXCEPTION(scope, {});
                append(lexicalGlobalObject, result, WTF::move(convertedValue));
            }
            return result;
        }

        for (unsigned i = 0; i < length; i++) {
            auto indexValue = array->getDirectIndex(&lexicalGlobalObject, i);
            RETURN_IF_EXCEPTION(scope, {});

            if (!indexValue)
                indexValue = JSC::jsUndefined();

            auto convertedValue = Bun::convertIDL<IDL>(lexicalGlobalObject, indexValue, elementCtx);
            RETURN_IF_EXCEPTION(scope, {});
            append(lexicalGlobalObject, result, WTF::move(convertedValue));
        }
        return result;
    }

    template<IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        auto* object = value.getObject();
        if (!object) {
            ctx.throwTypeMustBe(lexicalGlobalObject, scope, "a sequence"_s);
            return {};
        }

        if (WebCore::Converter<IDL>::conversionHasSideEffects)
            RELEASE_AND_RETURN(scope, (convertIterable(lexicalGlobalObject, object, ctx)));

        if (!JSC::isJSArray(object))
            RELEASE_AND_RETURN(scope, (convertIterable(lexicalGlobalObject, object, ctx)));

        JSC::JSArray* array = JSC::asArray(object);
        if (!array->isIteratorProtocolFastAndNonObservable())
            RELEASE_AND_RETURN(scope, (convertIterable(lexicalGlobalObject, object, ctx)));

        RELEASE_AND_RETURN(scope, (convertArray(lexicalGlobalObject, array, ctx)));
    }
};

}

template<typename IDL, typename VectorType>
struct WebCore::Converter<Bun::IDLSequenceWithStorage<IDL, VectorType>>
    : Bun::DefaultContextConverter<Bun::IDLSequenceWithStorage<IDL, VectorType>> {

    template<Bun::IDLConversionContext Ctx>
    static VectorType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        return Bun::Detail::SequenceConverter<IDL, VectorType>::convert(lexicalGlobalObject, value, ctx);
    }
};
