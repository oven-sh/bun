#pragma once
#include "root.h"
#include "BunClientData.h"
#include "Bindgen/ExternTraits.h"
#include "Bindgen/IDLConvert.h"
#include "ErrorCode.h"
#include "JSDOMWrapper.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/Lookup.h>

namespace Bun::Bindgen {
template<typename Traits> class JSBindgenObject;
}

// Reads the cell and nothing else: one of JSDOMWrapperType is a JSDestructibleObject, which holds its ClassInfo.
template<typename Traits>
struct JSC::JSCastingHelpers::InheritsTraits<Bun::Bindgen::JSBindgenObject<Traits>> {
    static constexpr std::optional<JSTypeRange> typeRange { std::nullopt };
    template<typename From>
    static inline bool inherits(From* from)
    {
        return from->type() == static_cast<JSType>(WebCore::JSDOMWrapperType)
            && static_cast<const JSDestructibleObject*>(static_cast<const JSCell*>(from))->classInfo() == Bun::Bindgen::JSBindgenObject<Traits>::info();
    }
};

namespace Bun::Bindgen {

// One per class, defined by generated code.
struct ClassDefinition {
    WTF::ASCIILiteral className;
    const JSC::ClassInfo* info;
    JSC::Structure* (*createStructure)(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    std::span<const JSC::HashTableValue> prototypeTableValues;
    std::span<const JSC::HashTableValue> constructorTableValues;
    // Properties a static table cannot describe (private names). May be null.
    void (*finishPrototypeCreation)(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
    // Null: `new` from JavaScript is not allowed, and there is no constructor object.
    JSC::NativeFunction construct;
    unsigned constructorLength;
};

// JSDestructibleObject | WriteBarrier internalFields[numberOfInternalFields] | the Rust payload
template<typename Traits>
class JSBindgenObject final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    // A payload is not one of a few sizes shared with other cells, so a precise-allocation tier buys nothing.
    static constexpr uint8_t numberOfLowerTierPreciseCells = 0;
    static constexpr unsigned numberOfInternalFields = Traits::numberOfInternalFields;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        auto& clientData = *downcast<WebCore::JSVMClientData>(vm.clientData);
        if (auto* space = clientData.clientSubspaces().m_clientSubspaceForBindgenClass[Traits::classIndex]) [[likely]]
            return space;
        RELEASE_ASSERT(allocationSize() <= JSC::MarkedSpace::largeCutoff);
        return WebCore::subspaceForImplSlow(
            vm,
            WebCore::SubspaceForInit { static_cast<unsigned>(allocationSize()), numberOfLowerTierPreciseCells, WebCore::SubspaceForInit::CellType::Destructible, false },
            BUN_SUBSPACE_SLOTS(m_clientSubspaceForBindgenClass[Traits::classIndex], m_subspaceForBindgenClass[Traits::classIndex]),
            nullptr);
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(WebCore::JSDOMWrapperType), StructureFlags), info());
    }

    // The payload is uninitialized: the caller writes it before anything else can run.
    static JSBindgenObject* create(JSC::VM& vm, JSC::Structure* structure)
    {
        auto* object = new (NotNull, JSC::allocateCell<JSBindgenObject>(vm, allocationSize())) JSBindgenObject(vm, structure);
        object->finishCreation(vm);
        return object;
    }

    static void destroy(JSC::JSCell* cell)
    {
        Traits::finalize(static_cast<JSBindgenObject*>(cell)->payload());
    }

    static constexpr size_t offsetOfInternalFields() { return sizeof(Base); }
    static constexpr size_t offsetOfPayload() { return offsetOfInternalFields() + numberOfInternalFields * sizeof(JSC::WriteBarrier<JSC::Unknown>); }
    static size_t allocationSize() { return offsetOfPayload() + Traits::payloadSize(); }

    void* payload() { return reinterpret_cast<uint8_t*>(this) + offsetOfPayload(); }
    JSC::WriteBarrier<JSC::Unknown>& internalField(unsigned index) { return internalFields()[index]; }
    std::span<JSC::WriteBarrier<JSC::Unknown>, numberOfInternalFields> internalFields()
    {
        return std::span<JSC::WriteBarrier<JSC::Unknown>, numberOfInternalFields> { reinterpret_cast<JSC::WriteBarrier<JSC::Unknown>*>(reinterpret_cast<uint8_t*>(this) + offsetOfInternalFields()), numberOfInternalFields };
    }

private:
    JSBindgenObject(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
        // Rust reads the schema's `internalFields`, which start as `undefined`. The rest hold cached getters: empty until computed.
        unsigned index = 0;
        for (auto& field : internalFields()) {
            new (NotNull, &field) JSC::WriteBarrier<JSC::Unknown>;
            if (index++ < numberOfInternalFields - Traits::numberOfCachedGetters)
                field.setWithoutWriteBarrier(JSC::jsUndefined());
        }
    }
};

template<typename Traits>
template<typename Visitor>
void JSBindgenObject<Traits>::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSBindgenObject>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    for (auto& field : thisObject->internalFields())
        visitor.append(field);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<typename Traits>, JSBindgenObject<Traits>);

template<typename Traits>
const JSC::ClassInfo JSBindgenObject<Traits>::s_info = { Traits::className, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBindgenObject) };

template<typename Traits> struct ExternTraits<JSBindgenObject<Traits>*> : TrivialExtern<JSBindgenObject<Traits>*> {};

// The constructor object of every generated class that has one.
class JSBindgenConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;
    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSBindgenConstructor, WebCore::UseCustomHeapCellType::No>(
            vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForBunClassConstructor, m_subspaceForBunClassConstructor));
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSBindgenConstructor* create(JSC::VM&, JSC::JSGlobalObject*, const ClassDefinition&, JSC::JSObject* prototype);

private:
    JSBindgenConstructor(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction construct);
};

// By index into Tables::classes (GeneratedBindings+Tables.h).
JSC::Structure* structureForClass(JSC::JSGlobalObject*, unsigned classIndex);
JSC::JSObject* constructorForClass(JSC::JSGlobalObject*, unsigned classIndex);
// The class's own, or one for `new.target` (a subclass, Reflect.construct). May throw.
JSC::Structure* structureForNewTarget(JSC::JSGlobalObject*, JSC::CallFrame*, unsigned classIndex);

}
