#pragma once 

namespace JSC {
    class Structure;
    class Identifier;
    
}

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include "JSCInlines.h"

using namespace JSC;


namespace Wundle {

class Script;

class DefaultGlobal final : public JSC::JSGlobalObject {
public:
    using Base = JSC::JSGlobalObject;

    DECLARE_EXPORT_INFO;
    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;

    static constexpr bool needsDestruction = true;
    template<typename CellType, SubspaceAccess mode>
    static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return vm.apiGlobalObjectSpace<mode>();
    }

    static DefaultGlobal* create(JSC::VM& vm, JSC::Structure* structure)
    {
        auto* object = new (NotNull, allocateCell<DefaultGlobal>(vm.heap)) DefaultGlobal(vm, structure);
        object->finishCreation(vm);
        return object;
    }

    static Structure* createStructure(JSC::VM& vm, JSC::JSValue prototype)
    {
        auto* result = Structure::create(vm, nullptr, prototype, TypeInfo(GlobalObjectType, StructureFlags), info());
        result->setTransitionWatchpointIsLikelyToBeFired(true);
        return result;
    }

    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, Exception*);

    static JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSModuleLoader*, JSC::JSString* moduleNameValue, JSValue parameters, const SourceOrigin&);
    static JSC::Identifier moduleLoaderResolve(JSGlobalObject*, JSModuleLoader*, JSValue keyValue, JSValue referrerValue, JSValue);
    static JSInternalPromise* moduleLoaderFetch(JSGlobalObject*, JSModuleLoader*, JSValue, JSValue, JSValue);
    static JSC::JSObject* moduleLoaderCreateImportMetaProperties(JSGlobalObject*, JSModuleLoader*, JSValue, JSModuleRecord*, JSValue);
    static JSValue moduleLoaderEvaluate(JSGlobalObject*, JSModuleLoader*, JSValue, JSValue, JSValue, JSValue, JSValue);


private:
    DefaultGlobal(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, &s_globalObjectMethodTable)
    { }
};


}

