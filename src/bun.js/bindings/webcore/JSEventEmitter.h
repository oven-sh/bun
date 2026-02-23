#pragma once

#include "root.h"
#include "EventEmitter.h"
#include "JSDOMWrapper.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {

JSC_DECLARE_HOST_FUNCTION(Events_functionGetEventListeners);
JSC_DECLARE_HOST_FUNCTION(Events_functionListenerCount);
JSC_DECLARE_HOST_FUNCTION(Events_functionOnce);
JSC_DECLARE_HOST_FUNCTION(Events_functionOn);

class JSEventEmitter : public JSDOMWrapper<EventEmitter> {
public:
    using Base = JSDOMWrapper<EventEmitter>;
    static JSEventEmitter* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<EventEmitter>&& impl)
    {
        JSEventEmitter* ptr = new (NotNull, JSC::allocateCell<JSEventEmitter>(globalObject->vm())) JSEventEmitter(structure, *globalObject, WTF::move(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static EventEmitter* toWrapped(JSC::VM&, JSC::JSValue);
    static void destroy(JSC::JSCell*);

    static inline JSC::EncodedJSValue addListener(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSEventEmitter* castedThis, bool once, bool prepend);
    static inline JSC::EncodedJSValue removeListener(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSEventEmitter* castedThis);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);
    DECLARE_VISIT_CHILDREN;
    template<typename Visitor> void visitAdditionalChildren(Visitor&);

    template<typename Visitor> static void visitOutputConstraints(JSCell*, Visitor&);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

protected:
    JSEventEmitter(JSC::Structure*, JSDOMGlobalObject&, Ref<EventEmitter>&&);

    void finishCreation(JSC::VM&);
};

class JSEventEmitterOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
};

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, EventEmitter*)
{
    static NeverDestroyed<JSEventEmitterOwner> owner;
    return &owner.get();
}

inline void* wrapperKey(EventEmitter* wrappableObject)
{
    return wrappableObject;
}

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, EventEmitter&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, EventEmitter* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<EventEmitter>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<EventEmitter>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<EventEmitter> {
    using WrapperClass = JSEventEmitter;
    using ToWrappedReturnType = EventEmitter*;
};

} // namespace WebCore
#include "JSEventEmitterCustom.h"
