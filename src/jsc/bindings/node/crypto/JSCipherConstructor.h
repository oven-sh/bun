#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>
#include "JSCipher.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(callCipher);
JSC_DECLARE_HOST_FUNCTION(constructCipheriv);
JSC_DECLARE_HOST_FUNCTION(constructDecipheriv);

class JSCipherConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSCipherConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype, CipherKind kind)
    {
        JSCipherConstructor* constructor = new (NotNull, JSC::allocateCell<JSCipherConstructor>(vm)) JSCipherConstructor(vm, structure, kind);
        constructor->finishCreation(vm, prototype, kind);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSCipherConstructor(JSC::VM& vm, JSC::Structure* structure, CipherKind kind)
        : Base(vm, structure, callCipher, kind == CipherKind::Cipher ? constructCipheriv : constructDecipheriv)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype, CipherKind kind)
    {
        Base::finishCreation(vm, 4, kind == CipherKind::Cipher ? "Cipheriv"_s : "Decipheriv"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

} // namespace Bun
