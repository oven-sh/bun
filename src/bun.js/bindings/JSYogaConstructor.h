#pragma once
#include "root.h"
#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

// JSYogaConfig Constructor
class JSYogaConfigConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    
    static JSYogaConfigConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSYogaConfigConstructor* constructor = new (NotNull, JSC::allocateCell<JSYogaConfigConstructor>(vm)) JSYogaConfigConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }
    
    DECLARE_INFO;
    
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }
    
private:
    JSYogaConfigConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, constructJSYogaConfig, constructJSYogaConfig)
    {
    }
    
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject*);
};

// JSYogaNode Constructor
class JSYogaNodeConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    
    static JSYogaNodeConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSYogaNodeConstructor* constructor = new (NotNull, JSC::allocateCell<JSYogaNodeConstructor>(vm)) JSYogaNodeConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }
    
    DECLARE_INFO;
    
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }
    
private:
    JSYogaNodeConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, constructJSYogaNode, constructJSYogaNode)
    {
    }
    
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject*);
};

// Forward declarations for construct functions
JSC_DECLARE_HOST_FUNCTION(constructJSYogaConfig);
JSC_DECLARE_HOST_FUNCTION(constructJSYogaNode);

// Setup functions for lazy class structure initialization
void setupJSYogaConfigClassStructure(JSC::LazyClassStructure::Initializer&);
void setupJSYogaNodeClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun