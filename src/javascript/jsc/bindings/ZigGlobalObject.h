#pragma once 

namespace JSC {
    class Structure;
    class Identifier;
    
}



#include <JavaScriptCore/JSGlobalObject.h>




namespace Zig {
    using namespace JSC;

class GlobalObject final : public JSGlobalObject {
public:
    using Base = JSGlobalObject;

    DECLARE_EXPORT_INFO;
    static const GlobalObjectMethodTable s_globalObjectMethodTable;

    static constexpr bool needsDestruction = true;
    template<typename CellType, SubspaceAccess mode>
    static IsoSubspace* subspaceFor(VM& vm)
    {
        return vm.apiGlobalObjectSpace<mode>();
    }

    static GlobalObject* create(VM& vm, Structure* structure)
    {
        auto* object = new (NotNull, allocateCell<GlobalObject>(vm.heap)) GlobalObject(vm, structure);
        object->finishCreation(vm);
        return object;
    }

    static Structure* createStructure(VM& vm, JSValue prototype)
    {
        auto* result = Structure::create(vm, nullptr, prototype, TypeInfo(GlobalObjectType, StructureFlags), info());
        result->setTransitionWatchpointIsLikelyToBeFired(true);
        return result;
    }

    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, Exception*);

    static JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSModuleLoader*, JSString* moduleNameValue, JSValue parameters, const SourceOrigin&);
    static Identifier moduleLoaderResolve(JSGlobalObject*, JSModuleLoader*, JSValue keyValue, JSValue referrerValue, JSValue);
    static JSInternalPromise* moduleLoaderFetch(JSGlobalObject*, JSModuleLoader*, JSValue, JSValue, JSValue);
    static JSObject* moduleLoaderCreateImportMetaProperties(JSGlobalObject*, JSModuleLoader*, JSValue, JSModuleRecord*, JSValue);
    static JSValue moduleLoaderEvaluate(JSGlobalObject*, JSModuleLoader*, JSValue, JSValue, JSValue, JSValue, JSValue);


private:
    GlobalObject(VM& vm, Structure* structure)
        : Base(vm, structure, &s_globalObjectMethodTable)
    { }
};

}



