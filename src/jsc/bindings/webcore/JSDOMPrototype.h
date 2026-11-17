#pragma once

#include "BunClientData.h"
#include "JSDOMWrapper.h"

namespace WebCore {

template<typename JSClass, unsigned additionalStructureFlags = 0>
class JSDOMPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | additionalStructureFlags;

    static JSDOMPrototype* create(JSC::VM& vm, JSDOMGlobalObject& globalObject, JSC::JSObject* parentPrototype)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDOMPrototype, Base);
        auto* structure = Bun::createClassStructure(vm, &globalObject, parentPrototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        auto* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSDOMPrototype))) JSDOMPrototype(vm, structure);
        prototype->finishCreation(vm);
        // Last: a put on a possible prototype flushes the VM's prototype chain caches.
        prototype->structure()->setMayBePrototype(true);
        return prototype;
    }

    DECLARE_INFO;

    static JSC::EncodedJSValue JIT_OPERATION_ATTRIBUTES constructorGetter(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName)
    {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        auto* prototype = dynamicDowncast<JSDOMPrototype>(JSC::JSValue::decode(thisValue));
        if (!prototype) [[unlikely]]
            return JSC::throwVMTypeError(lexicalGlobalObject, throwScope);
        return JSC::JSValue::encode(JSClass::getConstructor(vm, prototype->globalObject()));
    }

private:
    using Base::Base;

    // Must be defined for each specialization class.
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
