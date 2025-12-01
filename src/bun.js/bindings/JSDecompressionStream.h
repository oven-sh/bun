#pragma once

#include "JSDOMWrapper.h"

namespace WebCore {

class JSDecompressionStream : public JSDOMObject {
public:
    using Base = JSDOMObject;
    static JSDecompressionStream* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject)
    {
        JSDecompressionStream* ptr = new (NotNull, JSC::allocateCell<JSDecompressionStream>(globalObject->vm())) JSDecompressionStream(structure, *globalObject);
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    JSDecompressionStream(JSC::Structure*, JSDOMGlobalObject&);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
