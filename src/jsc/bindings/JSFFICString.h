#pragma once

#include "root.h"

#include <JavaScriptCore/InternalFunction.h>

namespace Bun {

using namespace JSC;

class JSFFICStringConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    DECLARE_INFO;

    static JSFFICStringConstructor* create(JSC::VM&, JSC::JSGlobalObject*);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSFFICStringConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM&);
};

}
