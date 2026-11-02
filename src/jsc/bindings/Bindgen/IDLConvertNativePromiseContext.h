#pragma once
#include "Bindgen/IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "NativePromiseContext.h"

// No type test: only the promise calls a reaction, with the context it was given.
template<> struct WebCore::Converter<Bun::Bindgen::IDLNativePromiseContext> : WebCore::DefaultConverter<Bun::Bindgen::IDLNativePromiseContext> {
    static void* convert(JSC::JSGlobalObject&, JSC::JSValue value)
    {
        return uncheckedDowncast<Bun::NativePromiseContext>(value)->take();
    }
};
