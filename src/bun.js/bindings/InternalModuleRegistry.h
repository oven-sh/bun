#pragma once
#include "root.h"
#include "JavaScriptCore/JSInternalFieldObjectImpl.h"
#include "JavaScriptCore/JSInternalFieldObjectImplInlines.h"
#include "../../../src/js/out/InternalModuleRegistry+numberOfModules.h"

namespace Bun {
using namespace JSC;

class InternalModuleRegistry : public JSInternalFieldObjectImpl<BUN_INTERNAL_MODULE_COUNT> {
protected:
    JS_EXPORT_PRIVATE InternalModuleRegistry(VM&, Structure*);
    DECLARE_DEFAULT_FINISH_CREATION;
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

    LazyProperty<JSGlobalObject, JSCell> m_internalModule[BUN_INTERNAL_MODULE_COUNT];

public:
    using Base = JSInternalFieldObjectImpl<BUN_INTERNAL_MODULE_COUNT>;

    enum Field : uint8_t {
#include "../../../src/js/out/InternalModuleRegistry+enum.h"
    };
    const WriteBarrier<Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    WriteBarrier<Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    template<typename, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.internalFieldTupleSpace();
    }

    static InternalModuleRegistry* create(VM& vm, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

    // This is like `require` but for internal modules present in `src/js/*`
    JSCell* require(JSGlobalObject* globalObject, Field id);
    // This is the js version of InternalModuleRegistry::require
    static JSC_DECLARE_HOST_FUNCTION(jsRequireId);

    DECLARE_EXPORT_INFO;
};

} // namespace Bun
