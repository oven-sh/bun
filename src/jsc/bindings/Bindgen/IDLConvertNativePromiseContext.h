#pragma once
#include "Bindgen/IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "NativePromiseContext.h"

// As for IDLPromisePtr.
template<> struct WebCore::Converter<Bun::Bindgen::IDLNativePromiseContext> : WebCore::DefaultConverter<Bun::Bindgen::IDLNativePromiseContext> {
    static void* convert(JSC::JSGlobalObject&, JSC::JSValue value)
    {
        return uncheckedDowncast<Bun::NativePromiseContext>(value)->take();
    }
};
