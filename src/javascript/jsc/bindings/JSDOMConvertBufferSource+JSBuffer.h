#pragma once

#include "BufferSource.h"
#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "JSDOMWrapperCache.h"
#include "JSBuffer.h"

namespace WebCore {

struct IDLJSBuffer : IDLTypedArray<WebCore::JSBuffer> {
};

template<> struct JSConverter<IDLJSBuffer> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Detail::getPtrOrRef(value));
    }

    template<typename U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        return convert(lexicalGlobalObject, globalObject, std::forward<U>(value));
    }
};

}