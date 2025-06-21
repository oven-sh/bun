#pragma once
#include "root.h"
#include <JavaScriptCore/JSNonFinalObject.h>

namespace Bun {

// JSYogaConfig Prototype
class JSYogaConfigPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    
    static JSYogaConfigPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSYogaConfigPrototype* prototype = new (NotNull, JSC::allocateCell<JSYogaConfigPrototype>(vm)) JSYogaConfigPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }
    
    DECLARE_INFO;
    
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }
    
private:
    JSYogaConfigPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

// JSYogaNode Prototype
class JSYogaNodePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    
    static JSYogaNodePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSYogaNodePrototype* prototype = new (NotNull, JSC::allocateCell<JSYogaNodePrototype>(vm)) JSYogaNodePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }
    
    DECLARE_INFO;
    
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }
    
private:
    JSYogaNodePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

} // namespace Bun