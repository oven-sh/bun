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

// Automocks a module's exports. With `spy` the mocks call through, and nested objects are mutated in place unless `leaveOriginalAlone`.
JSC::JSValue mockObject(Zig::GlobalObject*, JSC::JSValue exports, bool spy, bool leaveOriginalAlone = false);

// For `vi.dynamicImportSettled()`. `import` is the module loader's own promise for an `import()`, not the one script gets.
// `key` is null unless there are module mocks.
void didStartDynamicImport(Zig::GlobalObject*, JSC::JSPromise* import, const String& key);

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
    V(JSString, defaultName)                                      \
    V(JSString, vitestName)

#define DECLARE_JSMOCKMODULE_GC_MEMBER(T, name) \
    LazyProperty<JSGlobalObject, T> name;
    FOR_EACH_JSMOCKMODULE_GC_MEMBER(DECLARE_JSMOCKMODULE_GC_MEMBER)
#undef DECLARE_JSMOCKMODULE_GC_MEMBER

    static JSMockModule create(JSC::JSGlobalObject*);

    // Weak sets (ActiveSpySet), created on first use.
    JSC::WriteBarrier<JSC::Unknown> activeSpies;
    // Mocks that were called, or had `.mock` read, since they were last cleared.
    JSC::WriteBarrier<JSC::Unknown> calledMocks;
    // Mocks whose implementation or mock name may differ from what mockReset() gives them.
    JSC::WriteBarrier<JSC::Unknown> configuredMocks;

    // JSMaps from name to original value for `vi.stubEnv()` / `vi.stubGlobal()`, created on first use.
    JSC::WriteBarrier<JSC::Unknown> stubbedEnvs;
    JSC::WriteBarrier<JSC::Unknown> stubbedGlobals;
    // JSMaps from name to stub for what a preload stubbed. Reapplied when a test file ends, so the next one starts with them.
    JSC::WriteBarrier<JSC::Unknown> envsOfPreload;
    JSC::WriteBarrier<JSC::Unknown> globalsOfPreload;

    // A JSMap from the promises given to didStartDynamicImport() to their keys. Settled ones get swept.
    JSC::WriteBarrier<JSC::Unknown> dynamicImports;

    // True until the first test starts. A preload, or a beforeAll() of one, can only run before that.
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
