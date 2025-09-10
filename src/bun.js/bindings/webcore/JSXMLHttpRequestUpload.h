#pragma once

#include "JSDOMWrapper.h"
#include "JSEventTarget.h"

namespace WebCore {

class XMLHttpRequestUpload;

class JSXMLHttpRequestUpload : public JSEventTarget {
public:
    using Base = JSEventTarget;
    using DOMWrapped = XMLHttpRequestUpload;
    
    static JSXMLHttpRequestUpload* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<XMLHttpRequestUpload>&& impl)
    {
        return nullptr; // Stub for now
    }
    
    DECLARE_INFO;
    
    XMLHttpRequestUpload& wrapped() const;
};

template<> struct JSDOMWrapperConverterTraits<XMLHttpRequestUpload> {
    using WrapperClass = JSXMLHttpRequestUpload;
    using ToWrappedReturnType = XMLHttpRequestUpload*;
};

} // namespace WebCore