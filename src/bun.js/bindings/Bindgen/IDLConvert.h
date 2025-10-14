#pragma once
#include <BunIDLConvert.h>
#include "IDLTypes.h"
#include "IDLConvertBase.h"

namespace Bun {
template<> struct IDLHumanReadableName<Bindgen::IDLStrongAny> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("any");
};
}

template<> struct WebCore::Converter<Bun::Bindgen::IDLStrongAny>
    : WebCore::DefaultConverter<Bun::Bindgen::IDLStrongAny> {

    static Bun::StrongRef convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
    {
        return Bun::StrongRef { Bun__StrongRef__new(&globalObject, JSC::JSValue::encode(value)) };
    }
};
