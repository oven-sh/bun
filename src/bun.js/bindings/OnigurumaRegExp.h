#pragma once

#include "root.h"
#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"

extern "C" JSC::EncodedJSValue jsFunctionGetOnigurumaRegExpConstructor(JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName attributeName);

namespace Zig {

using namespace JSC;
using namespace WebCore;

class OnigurumaRegExpConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static OnigurumaRegExpConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSValue prototype);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    DECLARE_EXPORT_INFO;

    static JSC::Structure* createClassStructure(JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSC::JSObject* createPrototype(JSC::JSGlobalObject*);
    
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }


private:
    OnigurumaRegExpConstructor(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)
            : Base(vm, structure, nativeFunction, nativeFunction)
    
        {
        }
    

    void finishCreation(JSC::VM&, JSValue prototype);
};



}