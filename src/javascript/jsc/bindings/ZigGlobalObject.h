#include "root.h"

#pragma once 

namespace JSC {
    class Structure;
    class Identifier;
    
}


#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>

#include "ZigConsoleClient.h"


namespace Zig {



class GlobalObject final : public JSC::JSGlobalObject {
    using Base = JSC::JSGlobalObject;

public:

    DECLARE_EXPORT_INFO;
    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;

    static constexpr bool needsDestruction = true;
    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return vm.globalObjectSpace<mode>();
    }

    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure)
    {
        auto* object = new (NotNull, JSC::allocateCell<GlobalObject>(vm.heap)) GlobalObject(vm, structure);
        object->finishCreation(vm);
        return object;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSValue prototype)
    {
        auto* result = JSC::Structure::create(vm, nullptr, prototype, JSC::TypeInfo(JSC::GlobalObjectType, Base::StructureFlags), info());
        result->setTransitionWatchpointIsLikelyToBeFired(true);
        return result;
    }

    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, JSC::Exception*);

    static JSC::JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSString* moduleNameValue, JSC::JSValue parameters, const JSC::SourceOrigin&);
    static JSC::Identifier moduleLoaderResolve(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue keyValue, JSC::JSValue referrerValue, JSC::JSValue);
    static JSC::JSInternalPromise* moduleLoaderFetch(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSValue, JSC::JSValue);
    static JSC::JSObject* moduleLoaderCreateImportMetaProperties(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSModuleRecord*, JSC::JSValue);
    static JSC::JSValue moduleLoaderEvaluate(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue, JSC::JSValue);
    static void promiseRejectionTracker(JSGlobalObject*, JSC::JSPromise*, JSC::JSPromiseRejectionOperation);
    void setConsole(void* console);


private:
    
    GlobalObject(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSGlobalObject(vm, structure, &s_globalObjectMethodTable)
    {
      
    }
};

}



