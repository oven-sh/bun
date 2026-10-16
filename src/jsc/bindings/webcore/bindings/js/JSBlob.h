#pragma once

#include "JSDOMConvertInterface.h"
#include "blob.h"

namespace WebCore {

// Bun's Blob (and File) is a Rust class. A `WebCore::Blob` is a handle on one, made anew each time a JS Blob is converted.
struct JSBlobWrapperConverter {
    static RefPtr<Blob> toWrapped(JSC::JSGlobalObject&, JSC::JSValue value)
    {
        return Blob::create(value);
    }
};

template<> struct JSDOMWrapperConverterTraits<Blob> {
    using WrapperClass = JSBlobWrapperConverter;
    using ToWrappedReturnType = RefPtr<Blob>;
    static constexpr bool needsState = true;
};

} // namespace WebCore
