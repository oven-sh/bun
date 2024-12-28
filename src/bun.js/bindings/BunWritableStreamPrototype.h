#pragma once

#include "root.h"
#include "BunStreamStructures.h"

namespace Bun {

using namespace JSC;

class JSWritableStreamPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static JSWritableStreamPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype);

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSWritableStreamPrototype(VM& vm, Structure* structure);
    void finishCreation(VM& vm, JSGlobalObject* globalObject);
};

} // namespace Bun
