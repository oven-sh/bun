#pragma once

#include "JSDOMObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSValue.h>

namespace WebCore {

class JSDecompressionStream : public JSDOMObject {
public:
    using Base = JSDOMObject;
    static JSDecompressionStream* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject)
    {
        auto& vm = JSC::getVM(globalObject);
        JSDecompressionStream* ptr = new (NotNull, JSC::allocateCell<JSDecompressionStream>(vm)) JSDecompressionStream(structure, *globalObject);
        ptr->finishCreation(vm);
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static void destroy(JSC::JSCell*);

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

protected:
    JSDecompressionStream(JSC::Structure*, JSDOMGlobalObject&);

    DECLARE_DEFAULT_FINISH_CREATION;
};

} // namespace WebCore