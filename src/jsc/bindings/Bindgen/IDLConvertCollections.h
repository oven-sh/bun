#pragma once
#include "root.h"
#include "Bindgen/ExternTraits.h"
#include "Bindgen/ExternVectorTraits.h"
#include "Bindgen/IDLConvert.h"
#include <wtf/ScopedLambda.h>

namespace Bun::Bindgen {

template<typename T>
using MimallocVector = WTF::Vector<T, 0, WTF::CrashOnOverflow, 4, Bun::MimallocMalloc>;

template<typename IDL>
struct IDLSequenceOf : WebCore::IDLType<MimallocVector<typename IDL::ImplementationType>> {};

template<typename T>
struct RecordEntry {
    WTF::String key;
    T value;
};

template<typename IDL>
struct IDLRecordOf : WebCore::IDLType<MimallocVector<RecordEntry<typename IDL::ImplementationType>>> {};

template<typename T>
struct ExternRecordEntry {
    WTF::StringImpl* key;
    T value;
};

template<typename T>
struct ExternTraits<RecordEntry<T>> {
    using ExternType = ExternRecordEntry<typename ExternTraits<T>::ExternType>;

    static ExternType convertToExtern(RecordEntry<T>&& entry)
    {
        return { toExtern(entry.key), toExtern(entry.value) };
    }
};

// `object[Symbol.iterator]`, or undefined if that is nullish. Empty if it threw.
JSC::JSValue iteratorMethod(JSC::JSGlobalObject&, JSC::JSObject*);

namespace Detail {

// Out of line, so that there is one copy of each loop. These and the callbacks return false if they threw.
bool forEachElement(JSC::JSGlobalObject&, JSC::JSObject* iterable, JSC::JSValue iteratorMethod, const WTF::ScopedLambda<bool(JSC::JSValue)>&);
bool forEachRecordEntry(JSC::JSGlobalObject&, JSC::JSObject*, const WTF::ScopedLambda<bool(const WTF::String& key, JSC::JSValue)>&);

// How many elements to make room for. The length of an array says nothing of the memory behind it.
unsigned initialCapacityFor(JSC::JSObject* iterable);

bool throwOutOfMemory(JSC::JSGlobalObject&);

}

// `convertItem(value, ctx, slot)` converts `value` into `slot`, which was just default-constructed. All return false if they threw.

template<IDLConversionContext Ctx, typename T>
bool convertIterableInto(JSC::JSGlobalObject& globalObject, JSC::JSObject* iterable, JSC::JSValue method, Ctx& ctx, MimallocVector<T>& result, const auto& convertItem)
{
    if (!result.tryReserveInitialCapacity(Detail::initialCapacityFor(iterable))) [[unlikely]]
        return Detail::throwOutOfMemory(globalObject);
    auto itemCtx = ctx.contextForElement();
    return Detail::forEachElement(globalObject, iterable, method, [&](JSC::JSValue item) {
        if (!result.tryConstructAndAppend()) [[unlikely]]
            return Detail::throwOutOfMemory(globalObject);
        return convertItem(item, itemCtx, result.last());
    });
}

template<IDLConversionContext Ctx, typename T>
bool convertSequenceInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, MimallocVector<T>& result, const auto& convertItem)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
    if (auto* object = value.getObject()) [[likely]] {
        JSC::JSValue method = iteratorMethod(globalObject, object);
        if (hasException(scope, !!method)) [[unlikely]]
            return false;
        if (!method.isUndefined()) [[likely]]
            RELEASE_AND_RETURN(scope, convertIterableInto(globalObject, object, method, ctx, result, convertItem));
    }
    ctx.throwTypeMustBe(globalObject, scope, "an iterable object"_s);
    return false;
}

template<IDLConversionContext Ctx, typename T>
bool convertRecordInto(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx, MimallocVector<RecordEntry<T>>& result, const auto& convertItem)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
    auto* object = value.getObject();
    if (!object) [[unlikely]] {
        ctx.throwNotObject(globalObject, scope);
        return false;
    }
    auto itemCtx = ctx.contextForElement();
    RELEASE_AND_RETURN(scope, Detail::forEachRecordEntry(globalObject, object, [&](const WTF::String& key, JSC::JSValue item) {
        if (!result.tryConstructAndAppend()) [[unlikely]]
            return Detail::throwOutOfMemory(globalObject);
        result.last().key = key;
        return convertItem(item, itemCtx, result.last().value);
    }));
}

}

template<typename IDL>
struct Bun::IDLHumanReadableName<Bun::Bindgen::IDLSequenceOf<IDL>> : Bun::BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("iterable object");
};

template<typename IDL>
struct Bun::IDLHumanReadableName<Bun::Bindgen::IDLRecordOf<IDL>> : Bun::BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("object");
};
