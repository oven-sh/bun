/*
 * Copyright (C) 2008 Apple Inc. All rights reserved.
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "JSDOMWrapper.h"
#include "JSEventTarget.h"
#include "XMLHttpRequest.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {

class JSXMLHttpRequest : public JSEventTarget {
public:
    using Base = JSEventTarget;
    using DOMWrapped = XMLHttpRequest;
    
    static JSXMLHttpRequest* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<XMLHttpRequest>&& impl)
    {
        JSXMLHttpRequest* ptr = new (NotNull, JSC::allocateCell<JSXMLHttpRequest>(globalObject->vm())) JSXMLHttpRequest(structure, *globalObject, WTFMove(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static XMLHttpRequest* toWrapped(JSC::VM&, JSC::JSValue);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    
    template<typename, JSC::SubspaceAccess mode> 
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
    static size_t estimatedSize(JSCell*, JSC::VM&);
    
    XMLHttpRequest& wrapped() const
    {
        return static_cast<XMLHttpRequest&>(Base::wrapped());
    }

protected:
    JSXMLHttpRequest(JSC::Structure*, JSDOMGlobalObject&, Ref<XMLHttpRequest>&&);

    void finishCreation(JSC::VM&);
};

class JSXMLHttpRequestOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
};

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, XMLHttpRequest*)
{
    static NeverDestroyed<JSXMLHttpRequestOwner> owner;
    return &owner.get();
}

inline void* wrapperKey(XMLHttpRequest* wrappableObject)
{
    return wrappableObject;
}

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, XMLHttpRequest&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, XMLHttpRequest* impl) 
{ 
    return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); 
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<XMLHttpRequest>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<XMLHttpRequest>&& impl) 
{ 
    return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); 
}

template<> struct JSDOMWrapperConverterTraits<XMLHttpRequest> {
    using WrapperClass = JSXMLHttpRequest;
    using ToWrappedReturnType = XMLHttpRequest*;
};

JSC::JSValue getXMLHttpRequestConstructor(Zig::GlobalObject* globalObject);

} // namespace WebCore