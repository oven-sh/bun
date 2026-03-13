#pragma once

#include "JSDOMWrapper.h"
#include "CookieMap.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {

class JSCookieMap : public JSDOMWrapper<CookieMap> {
public:
    using Base = JSDOMWrapper<CookieMap>;
    static JSCookieMap* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<CookieMap>&& impl)
    {
        JSCookieMap* ptr = new (NotNull, JSC::allocateCell<JSCookieMap>(globalObject->vm())) JSCookieMap(structure, *globalObject, WTF::move(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static CookieMap* toWrapped(JSC::VM&, JSC::JSValue);
    static void destroy(JSC::JSCell*);

    DECLARE_INFO;

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
    JSCookieMap(JSC::Structure*, JSDOMGlobalObject&, Ref<CookieMap>&&);

    void finishCreation(JSC::VM&);
};
JSC::JSValue getInternalProperties(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSCookieMap* castedThis);
class JSCookieMapOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
};

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, CookieMap*)
{
    static NeverDestroyed<JSCookieMapOwner> owner;
    return &owner.get();
}

inline void* wrapperKey(CookieMap* wrappableObject)
{
    return wrappableObject;
}

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, CookieMap&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, CookieMap* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<CookieMap>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<CookieMap>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<CookieMap> {
    using WrapperClass = JSCookieMap;
    using ToWrappedReturnType = CookieMap*;
};

} // namespace WebCore
