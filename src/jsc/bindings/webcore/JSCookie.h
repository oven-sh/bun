#pragma once

#include "JSDOMWrapper.h"
#include "Cookie.h"
#include <wtf/NeverDestroyed.h>
#include <JavaScriptCore/DateInstance.h>
namespace WebCore {

class JSCookie : public JSDOMWrapper<Cookie> {
public:
    using Base = JSDOMWrapper<Cookie>;
    static JSCookie* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<Cookie>&& impl)
    {
        JSCookie* ptr = new (NotNull, JSC::allocateCell<JSCookie>(globalObject->vm())) JSCookie(structure, *globalObject, WTF::move(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static Cookie* toWrapped(JSC::VM&, JSC::JSValue);
    static void destroy(JSC::JSCell*);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    mutable WriteBarrier<JSC::DateInstance> m_expires;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(WebCore::JSAsJSONType), StructureFlags), info());
    }

    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);

protected:
    JSCookie(JSC::Structure*, JSDOMGlobalObject&, Ref<Cookie>&&);

    void finishCreation(JSC::VM&);
};

class JSCookieOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
};

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, Cookie*)
{
    static NeverDestroyed<JSCookieOwner> owner;
    return &owner.get();
}

inline void* wrapperKey(Cookie* wrappableObject)
{
    return wrappableObject;
}
JSC::JSValue getInternalProperties(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSCookie* castedThis);
JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, Cookie&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Cookie* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<Cookie>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<Cookie>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<Cookie> {
    using WrapperClass = JSCookie;
    using ToWrappedReturnType = Cookie*;
};

} // namespace WebCore
