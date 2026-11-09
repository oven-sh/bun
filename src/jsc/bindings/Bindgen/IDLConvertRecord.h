#pragma once
#include "Bindgen/ExternVectorTraits.h"
#include "Bindgen/IDLConvertBase.h"
#include "JSDOMConvertRecord.h"
#include "JSDOMConvertStrings.h"

namespace Bun::Bindgen {

template<typename T>
struct RecordEntry {
    WTF::String key;
    T value;
};

template<typename T>
struct ExternRecordEntry {
    WTF::StringImpl* key;
    T value;
};

template<typename T>
struct ExternTraits<RecordEntry<T>> {
    using ExternType = ExternRecordEntry<typename ExternTraits<T>::ExternType>;

    static ExternType convertToExtern(RecordEntry<T>&& cppValue)
    {
        return ExternType {
            .key = cppValue.key.releaseImpl().leakRef(),
            .value = ExternTraits<T>::convertToExtern(WTF::move(cppValue.value)),
        };
    }
};

// `b.record(V)` that is taken: WebIDL's `record<USVString, V>`.
template<typename IDL>
struct IDLRecord : WebCore::IDLType<WTF::Vector<RecordEntry<typename IDL::ImplementationType>, 0, WTF::CrashOnOverflow, 16, Bun::MimallocMalloc>> {};

namespace Detail {
// WebCore's converter of a record gives the converter of its values no context.
template<typename IDL>
struct IDLRecordValue : IDL {};
}

}

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::Detail::IDLRecordValue<IDL>> : WebCore::DefaultConverter<Bun::Bindgen::Detail::IDLRecordValue<IDL>> {
    using ReturnType = typename WebCore::Converter<IDL>::ReturnType;

    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        Bun::Bindgen::LiteralConversionContext ctx { "value of a record"_s };
        return Bun::convertIDL<IDL>(globalObject, value, ctx);
    }
};

template<typename IDL>
struct WebCore::Converter<Bun::Bindgen::IDLRecord<IDL>> : Bun::DefaultContextConverter<Bun::Bindgen::IDLRecord<IDL>> {
    using ReturnType = typename Bun::Bindgen::IDLRecord<IDL>::ImplementationType;

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!value.isObject()) {
            ctx.throwNotObject(globalObject, scope);
            return {};
        }
        auto pairs = WebCore::Converter<WebCore::IDLRecord<WebCore::IDLUSVString, Bun::Bindgen::Detail::IDLRecordValue<IDL>>>::convert(globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        ReturnType result;
        result.reserveInitialCapacity(pairs.size());
        for (auto& pair : pairs)
            result.append({ WTF::move(pair.key), WTF::move(pair.value) });
        return result;
    }
};
