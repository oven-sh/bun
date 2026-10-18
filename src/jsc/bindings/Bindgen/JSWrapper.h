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
template<typename Traits> class JSWrapper;
}

namespace JSC {
namespace JSCastingHelpers {

// A cell whose type is JSDOMWrapperType is a JSDestructibleObject, so its ClassInfo is in the cell: no Structure load.
template<typename Traits>
struct InheritsTraits<Bun::Bindgen::JSWrapper<Traits>> {
    static constexpr std::optional<JSTypeRange> typeRange { std::nullopt };
    template<typename From>
    static inline bool inherits(From* from)
    {
        using To = Bun::Bindgen::JSWrapper<Traits>;
        if (from->type() != static_cast<JSType>(WebCore::JSDOMWrapperType)) {
            ASSERT(!from->JSCell::inheritsSlow(To::info()));
            return false;
        }
        const ClassInfo* classInfo = uncheckedDowncast<const JSDestructibleObject>(from)->classInfo();
        ASSERT(classInfo == from->JSCell::classInfo());
        return classInfo == To::info();
    }
};

}
}

namespace Bun::Bindgen {

// Reports each field that holds a cell to a heap snapshot, as a property of that name.
void analyzeInternalFields(JSC::JSCell*, JSC::HeapAnalyzer&, std::span<const JSC::WriteBarrier<JSC::Unknown>>, std::span<const WTF::ASCIILiteral> names);

// JSDestructibleObject | WriteBarrier internalFields[numberOfInternalFields] | the Rust payload
template<typename Traits>
class JSWrapper final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr unsigned numberOfInternalFields = Traits::internalFieldNames.size();

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static void analyzeHeap(JSC::JSCell* cell, JSC::HeapAnalyzer& analyzer)
    {
        Base::analyzeHeap(cell, analyzer);
        analyzeInternalFields(cell, analyzer, uncheckedDowncast<JSWrapper>(cell)->internalFields(), Traits::internalFieldNames);
    }

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
    static JSWrapper* create(JSC::VM& vm, JSC::Structure* structure)
    {
        auto* object = new (NotNull, JSC::allocateCell<JSWrapper>(vm, allocationSize())) JSWrapper(vm, structure);
        object->finishCreation(vm);
        return object;
    }

    static void destroy(JSC::JSCell* cell)
    {
        STATIC_ASSERT_IS_TRIVIALLY_DESTRUCTIBLE(JSWrapper);
        Traits::finalize(static_cast<JSWrapper*>(cell)->payload());
    }

    static constexpr size_t offsetOfInternalFields() { return sizeof(Base); }
    static constexpr size_t offsetOfPayload() { return offsetOfInternalFields() + numberOfInternalFields * sizeof(JSC::WriteBarrier<JSC::Unknown>); }
    static size_t allocationSize() { return offsetOfPayload() + Traits::payloadSize(); }

    void* payload() { return std::bit_cast<char*>(this) + offsetOfPayload(); }
    JSC::WriteBarrier<JSC::Unknown>& internalField(unsigned index)
    {
        ASSERT(index < numberOfInternalFields);
        return internalFields()[index];
    }
    std::span<JSC::WriteBarrier<JSC::Unknown>, numberOfInternalFields> internalFields()
    {
        return std::span<JSC::WriteBarrier<JSC::Unknown>, numberOfInternalFields> { std::bit_cast<JSC::WriteBarrier<JSC::Unknown>*>(std::bit_cast<char*>(this) + offsetOfInternalFields()), numberOfInternalFields };
    }

private:
    JSWrapper(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
        for (auto& field : internalFields())
            new (NotNull, &field) JSC::WriteBarrier<JSC::Unknown>(JSC::UndefinedWriteBarrierTag);
    }

    DECLARE_DEFAULT_FINISH_CREATION;
};

template<typename Traits>
template<typename Visitor>
void JSWrapper<Traits>::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSWrapper>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    // Hidden: `analyzeHeap` reports them by name.
    visitor.appendValuesHidden(thisObject->internalFields().data(), numberOfInternalFields);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<typename Traits>, JSWrapper<Traits>);

template<typename Traits>
const JSC::ClassInfo JSWrapper<Traits>::s_info = { Traits::className, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWrapper) };

template<typename Traits> struct ExternTraits<JSWrapper<Traits>*> : TrivialExtern<JSWrapper<Traits>*> {};

// The constructor object of every generated class that has one.
class JSClassConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSClassConstructor* create(JSC::VM&, JSC::JSGlobalObject*, WTF::ASCIILiteral name, JSC::NativeFunction construct, unsigned length, std::span<const JSC::HashTableValue>, JSC::JSObject* prototype);

private:
    JSClassConstructor(JSC::VM&, JSC::Structure*, JSC::NativeFunction construct);
};

// A plain object with the properties of the table.
JSC::JSObject* createClassPrototype(JSC::VM&, JSC::JSGlobalObject*, const JSC::ClassInfo*, std::span<const JSC::HashTableValue>);

JSC::Structure* structureForClass(JSC::JSGlobalObject*, unsigned classIndex);
JSC::JSObject* constructorForClass(JSC::JSGlobalObject*, unsigned classIndex);
// The class's own, or one for `new.target` (a subclass, Reflect.construct). May throw.
JSC::Structure* structureForNewTarget(JSC::JSGlobalObject*, JSC::CallFrame*, unsigned classIndex);

}
