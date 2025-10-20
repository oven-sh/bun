#pragma once
#include "BunIDLTypes.h"
#include "BunIDLConvertBase.h"
#include "blob.h"
#include "ZigGeneratedClasses.h"

namespace Bun {
struct IDLBlobRef : IDLBunInterface<WebCore::BlobImpl, WebCore::BlobImplRefDerefTraits> {};
}

template<> struct WebCore::Converter<Bun::IDLBlobRef> : Bun::DefaultTryConverter<Bun::IDLBlobRef> {
    static constexpr bool conversionHasSideEffects = false;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<typename Bun::IDLBlobRef::ImplementationType> tryConvert(
        JSC::JSGlobalObject& globalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (auto* jsBlob = JSC::jsDynamicCast<WebCore::JSBlob*>(value)) {
            if (void* wrapped = jsBlob->wrapped()) {
                return static_cast<BlobImpl*>(wrapped);
            }
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
