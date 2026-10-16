#pragma once
#include "Bindgen/IDLTypes.h"
#include "BunIDLConvertBase.h"
#include "blob.h"
#include "ZigGeneratedClasses.h"

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
        if (auto* jsBlob = dynamicDowncast<WebCore::JSBlob>(value)) {
            if (void* wrapped = jsBlob->wrapped())
                return static_cast<BlobImpl*>(wrapped);
        }
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
