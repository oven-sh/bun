#pragma once

#include "BunClientData.h"
#include "JSDOMWrapperCache.h"

namespace WebCore {

// `Parent` is the wrapper class of the interface that this one inherits from.
template<typename JSClass, typename Impl, typename Parent = JSDOMWrapper<Impl>>
class JSDOMInterface : public Parent {
public:
    using Base = Parent;
    using DOMWrapped = Impl;

    static JSClass* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<Impl>&& impl)
    {
        auto& vm = JSC::getVM(globalObject);
        auto* wrapper = new (NotNull, JSC::allocateCell<JSClass>(vm)) JSClass(structure, *globalObject, WTF::move(impl));
        wrapper->finishCreation(vm);
        ASSERT(wrapper->inherits(JSClass::info()));
        return wrapper;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(JSClass::jsType), JSClass::StructureFlags), JSClass::info());
    }

    static JSC::JSObject* prototype(JSC::VM& vm, JSDOMGlobalObject& globalObject) { return getDOMPrototype<JSClass>(vm, globalObject); }

    static Impl* toWrapped(JSC::VM&, JSC::JSValue value)
    {
        auto* wrapper = dynamicDowncast<JSClass>(value);
        return wrapper ? &wrapper->wrapped() : nullptr;
    }

    static void destroy(JSC::JSCell* cell) { static_cast<JSClass*>(cell)->JSClass::~JSClass(); }

    template<typename CellType, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        static_assert(std::is_same_v<CellType, JSClass>, "a subclass needs a subspace of its own");
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl<JSClass, UseCustomHeapCellType::No>(vm, JSClass::subspaceSlots);
    }

    Impl& wrapped() const { return static_cast<Impl&>(Parent::wrapped()); }
    Ref<Impl> protectedWrapped() const { return wrapped(); }

    // JSClass declares its own: those of `Parent` are not inherited.
    static void createPrototype() = delete;
    static void getConstructor() = delete;
    static void subspaceSlots() = delete;
    void isReachableFromOpaqueRoots() = delete;

protected:
    JSDOMInterface(JSC::Structure* structure, JSDOMGlobalObject& globalObject, Ref<Impl>&& impl)
        : Parent(structure, globalObject, WTF::move(impl))
    {
    }
};

// For an `Impl` that holds JS values: JSClass::visitAdditionalChildrenInGCThread() runs with the cell and as an output constraint.
template<typename JSClass, typename Impl, typename Parent = JSDOMWrapper<Impl>>
class JSDOMInterfaceWithAdditionalChildren : public JSDOMInterface<JSClass, Impl, Parent> {
public:
    // A JSClass with a visitChildren() of its own calls this one: `Base` names `Parent`.
    template<typename Visitor> static void visitChildren(JSC::JSCell* cell, Visitor& visitor)
    {
        typename Visitor::ReferrerContext context(visitor, cell);
        ASSERT_GC_OBJECT_INHERITS(cell, JSClass::info());
        Parent::visitChildren(cell, visitor);
        uncheckedDowncast<JSClass>(cell)->visitAdditionalChildrenInGCThread(visitor);
    }

    template<typename Visitor> static void visitOutputConstraints(JSC::JSCell* cell, Visitor& visitor)
    {
        ASSERT_GC_OBJECT_INHERITS(cell, JSClass::info());
        Parent::visitOutputConstraints(cell, visitor);
        uncheckedDowncast<JSClass>(cell)->visitAdditionalChildrenInGCThread(visitor);
    }

    void visitAdditionalChildrenInGCThread() = delete;

protected:
    using JSDOMInterface<JSClass, Impl, Parent>::JSDOMInterface;
};

} // namespace WebCore
