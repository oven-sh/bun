#include "root.h"
#include "ZigGlobalObject.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

class SSRRouteInfo;

void createBakeProductionSSRRouteInfoStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto structure = JSC::Structure::create(init.vm, init.global, init.global->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, 0), JSFinalObject::info(), NonArray, 4);
    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "serverEntryPointModule"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routeModules"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "styles"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "clientEntryUrls"_s), 0, offset);
    init.setStructure(structure);
}

JSFinalObject* createRouteInfoObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto zigGlobalObject = defaultGlobalObject(globalObject);
    auto* structure = zigGlobalObject->bakeAdditions().m_BakeProductionSSRRouteInfoClassStructure.get(zigGlobalObject);
    return constructEmptyObject(vm, structure);
}

class BakeProductionSSRRouteList final : public JSC::JSDestructibleObject {
private:
    WTF::FixedVector<WriteBarrier<JSC::JSFinalObject>> m_routeInfos;
    WTF::FixedVector<WriteBarrier<Structure>> m_paramsObjectStructures;

public:
    using Base = JSC::JSDestructibleObject;

    BakeProductionSSRRouteList(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, size_t routeCount)
        : Base(vm, structure)
        , m_routeInfos(routeCount)
        , m_paramsObjectStructures(routeCount)
    {
    }

    static BakeProductionSSRRouteList* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, size_t routeCount)
    {
        // FIXME: let's not create this everytime
        auto* structure = JSC::Structure::create(vm, globalObject, globalObject->nullPrototype(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());

        auto* routeList = new (NotNull, JSC::allocateCell<BakeProductionSSRRouteList>(vm)) BakeProductionSSRRouteList(vm, globalObject, structure, routeCount);
        routeList->finishCreation(vm, globalObject);
        return routeList;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        for (size_t i = 0; i < m_routeInfos.size(); i++) {
            m_routeInfos[i].setMayBeNull(vm, this, createRouteInfoObject(vm, globalObject));
            m_paramsObjectStructures[i].setMayBeNull(vm, this, nullptr);
        }
    }

    JSFinalObject* routeInfo(size_t index) const
    {
        return m_routeInfos[index].get();
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<BakeProductionSSRRouteList, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBakeProductionSSRRouteList.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBakeProductionSSRRouteList = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBakeProductionSSRRouteList.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBakeProductionSSRRouteList = std::forward<decltype(space)>(space); });
    }
};

const JSC::ClassInfo BakeProductionSSRRouteList::s_info = { "BakeProductionSSRRouteList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(BakeProductionSSRRouteList) };

template<typename Visitor>
void BakeProductionSSRRouteList::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    BakeProductionSSRRouteList* thisCallSite = jsCast<BakeProductionSSRRouteList*>(cell);
    Base::visitChildren(thisCallSite, visitor);

    for (unsigned i = 0; i < thisCallSite->m_routeInfos.size(); i++) {
        if (thisCallSite->m_routeInfos[i]) visitor.append(thisCallSite->m_routeInfos[i]);
        // if (thisCallSite->m_paramsObjectStructures[i]) visitor.append(thisCallSite->m_paramsObjectStructures[i]);
    }
}
DEFINE_VISIT_CHILDREN(BakeProductionSSRRouteList);

extern "C" JSC::EncodedJSValue Bun__BakeProductionSSRRouteList__create(Zig::GlobalObject* globalObject, size_t routeCount)
{
    auto* routeList = BakeProductionSSRRouteList::create(globalObject->vm(), globalObject, routeCount);
    return JSValue::encode(routeList);
}

extern "C" JSC::EncodedJSValue Bun__BakeProductionSSRRouteList__getRouteInfo(Zig::GlobalObject* globalObject, EncodedJSValue routeListObject, size_t index)
{
    JSValue routeListValue = JSValue::decode(routeListObject);
    BakeProductionSSRRouteList* routeList = jsCast<BakeProductionSSRRouteList*>(routeListValue);
    return JSValue::encode(routeList->routeInfo(index));
}
}
