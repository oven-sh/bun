#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSValue.h>
#include <JavaScriptCore/JSCell.h>

namespace Bun {

using namespace JSC;

class JSReadableStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSReadableStreamPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype);

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(VM& vm);

private:
    JSReadableStreamPrototype(VM& vm, Structure* structure);
    void finishCreation(VM& vm, JSGlobalObject* globalObject);
};

} // namespace Bun
