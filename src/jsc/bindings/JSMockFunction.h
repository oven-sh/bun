#pragma once

#include "root.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/Strong.h>

namespace WebCore {
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSMockFunction;

// Wrapper to scope a bunch of GlobalObject properties related to mocks
class JSMockModule final {
public:
    static uint64_t s_nextInvocationId;
    static uint64_t nextInvocationId() { return ++s_nextInvocationId; }

#define FOR_EACH_JSMOCKMODULE_GC_MEMBER(V)           \
    V(Structure, mockFunctionStructure)              \
    V(Structure, mockResultStructure)                \
    V(Structure, mockImplementationStructure)        \
    V(Structure, mockObjectStructure)                \
    V(Structure, mockModuleStructure)                \
    V(Structure, activeSpySetStructure)              \
    V(JSFunction, withImplementationCleanupFunction) \
    V(JSC::Structure, mockWithImplementationCleanupDataStructure)

#define DECLARE_JSMOCKMODULE_GC_MEMBER(T, name) \
    LazyProperty<JSGlobalObject, T> name;
    FOR_EACH_JSMOCKMODULE_GC_MEMBER(DECLARE_JSMOCKMODULE_GC_MEMBER)
#undef DECLARE_JSMOCKMODULE_GC_MEMBER

    static JSMockModule create(JSC::JSGlobalObject*);

    // These are used by "spyOn"
    // This is useful for iterating through every non-GC'd spyOn
    JSC::Strong<JSC::Unknown> activeSpies;

    // Every JSMockFunction::create appends to this list
    // This is useful for iterating through every non-GC'd mock function
    // This list includes activeSpies
    JSC::Strong<JSC::Unknown> activeMocks;

    // Side cache for `jest.requireMock(specifier)` when no explicit
    // `jest.mock(specifier)` has been called. We keep it separate from the
    // `onLoadPlugins.virtualModules` map so that `require()`/`import()` of
    // the same specifier still see the real module — matching Jest's
    // distinction between `jest.mock()` (global) and `jest.requireMock()`
    // (local handle).
    JSC::Strong<JSC::JSMap> requireMockCache;

    // Called by Zig::GlobalObject::visitChildren
    template<typename Visitor>
    void visit(Visitor& visitor);
};

// Create a mock function equivalent to `mock.fn()` / `jest.fn()` with no
// implementation. Used by auto-mock. Returns null on failure (OOM, etc.) —
// the caller is responsible for checking for exceptions.
JSC::JSObject* createAutoMockedFunction(JSC::JSGlobalObject* globalObject, JSC::JSValue originalValue);

// Generate an auto-mock value from a module's real exports. For each own
// enumerable property of `exports`:
//   - function: replaced with a mock function that returns undefined (plus
//     any of its own properties mocked recursively so static methods work)
//   - plain object: recursively auto-mocked
//   - primitives, arrays, other non-plain objects: preserved
// Returns an empty JSValue on failure with an exception pending.
//
// Note: primitive exports (e.g. CJS `module.exports = 42`) come through as
// non-object JSValues — callers must decide whether to wrap them.
JSC::JSValue createAutoMockFromExports(JSC::JSGlobalObject* globalObject, JSC::JSValue exports);

class MockWithImplementationCleanupData : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    JS_EXPORT_PRIVATE static MockWithImplementationCleanupData* create(VM&, Structure*);
    static MockWithImplementationCleanupData* create(JSC::JSGlobalObject* globalObject, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback);
    static MockWithImplementationCleanupData* createWithInitialValues(VM&, Structure*);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    static std::array<JSValue, numberOfInternalFields> initialValues()
    {
        return { {
            jsUndefined(),
            jsUndefined(),
            jsUndefined(),
            jsUndefined(),
        } };
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    MockWithImplementationCleanupData(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback);
};
}
