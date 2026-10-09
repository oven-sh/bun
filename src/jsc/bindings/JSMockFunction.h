#pragma once

#include "root.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/Strong.h>

namespace WebCore {
}

namespace Zig {
class GlobalObject;
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSMockFunction;

// The exports of a module with every function in them mocked. With `spy` the mocks call through, and objects nested in `exports` are changed in place unless `leaveOriginalAlone`.
JSC::JSValue mockObject(Zig::GlobalObject*, JSC::JSValue exports, bool spy, bool leaveOriginalAlone = false);

// For `vi.dynamicImportSettled`. `import` is the module loader's promise for an `import()`, not the one script gets.
void didStartDynamicImport(Zig::GlobalObject*, JSC::JSPromise* import);

// Wrapper to scope a bunch of GlobalObject properties related to mocks
class JSMockModule final {
public:
    static uint64_t s_nextInvocationId;
    static uint64_t nextInvocationId() { return ++s_nextInvocationId; }

#define FOR_EACH_JSMOCKMODULE_GC_MEMBER(V)                        \
    V(Structure, mockFunctionStructure)                           \
    V(Structure, mockResultStructure)                             \
    V(Structure, mockImplementationStructure)                     \
    V(Structure, mockObjectStructure)                             \
    V(Structure, mockModuleStructure)                             \
    V(Structure, activeSpySetStructure)                           \
    V(JSFunction, withImplementationCleanupFunction)              \
    V(JSC::Structure, mockWithImplementationCleanupDataStructure) \
    V(JSCell, lazyPrototype)                                      \
    V(JSString, defaultName)

#define DECLARE_JSMOCKMODULE_GC_MEMBER(T, name) \
    LazyProperty<JSGlobalObject, T> name;
    FOR_EACH_JSMOCKMODULE_GC_MEMBER(DECLARE_JSMOCKMODULE_GC_MEMBER)
#undef DECLARE_JSMOCKMODULE_GC_MEMBER

    static JSMockModule create(JSC::JSGlobalObject*);

    // Weak sets, each made by the first mock that enters it. A mock leaves one only as it is brought back to the state that the set is there to find.
    // The spies that have not been restored
    JSC::WriteBarrier<JSC::Unknown> activeSpies;
    // The mocks that were called, or whose `mock` was read, since they were last cleared
    JSC::WriteBarrier<JSC::Unknown> calledMocks;
    // The mocks whose implementations or mock name may not be the ones that resetting gives them
    JSC::WriteBarrier<JSC::Unknown> configuredMocks;

    // What `vi.stubEnv` / `vi.stubGlobal` replaced: a JSMap from name to original, created by the first stub
    JSC::WriteBarrier<JSC::Unknown> stubbedEnvs;
    JSC::WriteBarrier<JSC::Unknown> stubbedGlobals;
    // What a preload stubbed: a JSMap from name to stub. Every test file starts with these.
    JSC::WriteBarrier<JSC::Unknown> envsOfPreload;
    JSC::WriteBarrier<JSC::Unknown> globalsOfPreload;

    // A JSMap whose keys are what `didStartDynamicImport` was given, less the settled ones that were swept
    JSC::WriteBarrier<JSC::Unknown> dynamicImports;

    // No test has started yet. Only until then does a preload load, or a beforeAll() of it run.
    bool preloadMayBeRunning { true };

    // Called by GlobalObject::visitChildren
    template<typename Visitor>
    void visit(Visitor& visitor);
};

class MockWithImplementationCleanupData : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    JS_EXPORT_PRIVATE static MockWithImplementationCleanupData* create(VM&, Structure*);
    static MockWithImplementationCleanupData* create(JSC::JSGlobalObject* globalObject, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    MockWithImplementationCleanupData(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback);
};
}
