#pragma once

#include "JSDOMWrapper.h"
#include "JSEventTarget.h"
#include "Profiler.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {

class JSProfiler : public JSEventTarget {
public:
    using Base = JSEventTarget;
    using DOMWrapped = Profiler;

    static JSProfiler* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<Profiler>&& impl)
    {
        JSProfiler* ptr = new (NotNull, JSC::allocateCell<JSProfiler>(globalObject->vm())) JSProfiler(structure, *globalObject, WTFMove(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static Profiler* toWrapped(JSC::VM&, JSC::JSValue);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    Profiler& wrapped() const
    {
        return static_cast<Profiler&>(Base::wrapped());
    }

protected:
    JSProfiler(JSC::Structure*, JSDOMGlobalObject&, Ref<Profiler>&&);

    void finishCreation(JSC::VM&);
};

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, Profiler&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Profiler* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<Profiler>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<Profiler>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<Profiler> {
    using WrapperClass = JSProfiler;
    using ToWrappedReturnType = Profiler*;
};

} // namespace WebCore
