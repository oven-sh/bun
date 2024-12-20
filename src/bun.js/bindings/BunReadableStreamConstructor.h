#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSValue.h>

namespace Bun {

using namespace JSC;

class JSReadableStreamConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    static JSReadableStreamConstructor* create(VM&, JSGlobalObject*, Structure*, JSObject*);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype);

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(VM& vm);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSGlobalObject*, CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSGlobalObject*, CallFrame*);

private:
    JSReadableStreamConstructor(VM& vm, Structure* structure);
    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype);
};

} // namespace Bun
