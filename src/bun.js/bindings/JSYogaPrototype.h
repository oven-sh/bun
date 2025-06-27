#pragma once
#include "root.h"
#include <JavaScriptCore/JSObject.h>

namespace Bun {

// Base class for Yoga prototypes
class JSYogaConfigPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSYogaConfigPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSYogaConfigPrototype* prototype = new (NotNull, allocateCell<JSYogaConfigPrototype>(vm)) JSYogaConfigPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSYogaConfigPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    
public:
    void setConstructor(JSC::VM& vm, JSC::JSObject* constructor);
};

class JSYogaNodePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSYogaNodePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSYogaNodePrototype* prototype = new (NotNull, allocateCell<JSYogaNodePrototype>(vm)) JSYogaNodePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSYogaNodePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    
public:
    void setConstructor(JSC::VM& vm, JSC::JSObject* constructor);
};

} // namespace Bun
