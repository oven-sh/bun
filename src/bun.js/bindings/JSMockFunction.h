#pragma once

#include "root.h"
#include "JavaScriptCore/LazyProperty.h"
#include "JavaScriptCore/Strong.h"

namespace WebCore {
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSMockFunction;

class JSMockModule final {
public:
    static uint64_t s_nextInvocationId;
    static uint64_t nextInvocationId() { return ++s_nextInvocationId; }

    LazyProperty<JSC::JSGlobalObject, Structure> mockFunctionStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockResultStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockImplementationStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> mockObjectStructure;
    LazyProperty<JSC::JSGlobalObject, Structure> activeSpySetStructure;
    LazyProperty<JSC::JSGlobalObject, JSFunction> withImplementationCleanupFunction;
    LazyProperty<JSC::JSGlobalObject, JSC::Structure> mockWithImplementationCleanupDataStructure;

    static JSMockModule create(JSC::JSGlobalObject*);

    JSC::Strong<Unknown> activeSpies;
};

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
