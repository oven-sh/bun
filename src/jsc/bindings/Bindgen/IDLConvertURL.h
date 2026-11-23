#pragma once
#include "Bindgen/IDLConvert.h"
#include "JSDOMURL.h"

namespace Bun::Bindgen {
// A `URL` as the `JSValue` itself. See IDLRawAny.
struct IDLRawURL : IDLRawAny {};
}

template<> struct Bun::IDLHumanReadableName<Bun::Bindgen::IDLRawURL> : Bun::BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("URL");
};

template<> struct WebCore::Converter<Bun::Bindgen::IDLRawURL> : Bun::DefaultTryConverter<Bun::Bindgen::IDLRawURL> {
    template<Bun::IDLConversionContext Ctx>
    static std::optional<JSC::JSValue> tryConvert(JSC::JSGlobalObject&, JSC::JSValue value, Ctx&)
    {
        if (!value.inherits<WebCore::JSDOMURL>())
            return std::nullopt;
        return value;
    }

    template<Bun::IDLConversionContext Ctx>
    static void throwConversionFailed(JSC::JSGlobalObject& globalObject, JSC::ThrowScope& scope, Ctx& ctx)
    {
        ctx.throwTypeMustBe(globalObject, scope, "an instance of URL"_s);
    }
};
