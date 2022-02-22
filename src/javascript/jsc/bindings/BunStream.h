#pragma once

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "root.h"

namespace Bun {

using namespace JSC;

class Readable : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    Bun__Readable* state;
    Readable(JSC::VM& vm, Bun__Readable* readable, JSC::Structure* structure)
        : Base(vm, structure)
    {
        state = readable;
    }

    ~Readable();

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename CellType, SubspaceAccess> static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static Readable* create(JSC::VM& vm, Bun__Readable* state, JSC::Structure* structure)
    {
        Readable* accessor = new (NotNull, JSC::allocateCell<Bun::Readable>(vm)) Readable(vm, state, structure);
        accessor->finishCreation(vm);
        return accessor;
    }

    void finishCreation(JSC::VM& vm);
};

class Writable : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    Bun__Writable* state;
    Writable(JSC::VM& vm, Bun__Writable* writable, JSC::Structure* structure)
        : Base(vm, structure)
    {
        state = writable;
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename CellType, SubspaceAccess> static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static Writable* create(JSC::VM& vm, Bun__Writable* state, JSC::Structure* structure)
    {

        Writable* accessor = new (NotNull, JSC::allocateCell<Writable>(vm)) Writable(vm, state, structure);
        accessor->finishCreation(vm);
        return accessor;
    }
    ~Writable();

    void finishCreation(JSC::VM& vm);
};

} // namespace Bun