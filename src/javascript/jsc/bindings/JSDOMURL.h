#pragma once

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "DOMURL.h"
#include "JSDOMWrapper.h"
#include "root.h"

namespace WebCore {

using namespace WebCore;
using namespace JSC;

class JSDOMURL : public JSDOMWrapper<DOMURL> {
    using Base = JSDOMWrapper<DOMURL>;

public:
    JSDOMURL(JSC::Structure* structure, JSC::JSGlobalObject& global, DOMURL& domURL)
        : Base(structure, global, domURL)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSDOMURL* create(JSC::Structure* structure, JSC::JSGlobalObject* global, Ref<DOMURL> domURL)
    {
        JSDOMURL* accessor = new (NotNull, JSC::allocateCell<JSDOMURL>(global->vm())) JSDOMURL(structure, *global, WTFMove(domURL));
        accessor->finishCreation(global->vm());
        return accessor;
    }

    void finishCreation(JSC::VM& vm);
};

} // namespace Zig