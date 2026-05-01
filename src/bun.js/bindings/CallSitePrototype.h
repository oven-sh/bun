/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include <JavaScriptCore/JSObject.h>

using namespace JSC;

namespace Zig {

class CallSitePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static CallSitePrototype* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject)
    {
        CallSitePrototype* callSitePrototype = new (NotNull, JSC::allocateCell<CallSitePrototype>(vm)) CallSitePrototype(vm, structure);
        callSitePrototype->finishCreation(vm, globalObject);
        return callSitePrototype;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(CallSitePrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    CallSitePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
};

}
