#pragma once
#include "Bindgen/IDLTypes.h"
#include "BunIDLConvertBase.h"
#include "blob.h"
#include "GeneratedBlob.h"

namespace Bun::Bindgen {
struct IDLBlobRef : IDLRef<WebCore::BlobImpl, WebCore::BlobImplRefDerefTraits> {};
}

template<> struct WebCore::Converter<Bun::Bindgen::IDLBlobRef> : Bun::DefaultTryConverter<Bun::Bindgen::IDLBlobRef> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<typename Bun::Bindgen::IDLBlobRef::ImplementationType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (auto* jsBlob = dynamicDowncast<Bun::Bindgen::Generated::JSBlob>(value))
            return static_cast<BlobImpl*>(jsBlob->wrapped());
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(
        JSC::JSGlobalObject& globalObject,
        JSC::ThrowScope& scope,
        Ctx& ctx)
    {
        ctx.throwNotBlob(globalObject, scope);
    }
};
