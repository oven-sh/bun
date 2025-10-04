#include "root.h"
#include "ZigGlobalObject.h"
#include "JSBunRequest.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

extern "C" int Bun__BakeProductionSSRRouteInfo__dataForInitialization(JSGlobalObject* globalObject, void* zigRequestPtr, size_t routerIndex, JSC::EncodedJSValue* routerTypeMain, JSC::EncodedJSValue* routeModules, JSC::EncodedJSValue* clientEntryUrl, JSC::EncodedJSValue* styles);

// Called by the production server runtime in JS to get the data to initialize the arguments for a route to render it
JSC_DEFINE_HOST_FUNCTION(jsBakeProductionSSRRouteInfoPrototypeFunction_dataForInitialization, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (callframe->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "Expected 3 argument"_s);
        return {};
    }

    JSValue requestObject = callframe->argument(0);
    JSValue routerIndex = callframe->argument(1);

    if (requestObject.isEmpty() || requestObject.isUndefinedOrNull() || !requestObject.isCell()) {
        throwTypeError(globalObject, scope, "Expected first argument to be a non-empty object"_s);
        return {};
    }

    if (!routerIndex.isInt32()) {
        throwTypeError(globalObject, scope, "Expected second argument to be a number"_s);
        return {};
    }

    JSBunRequest* request = jsCast<JSBunRequest*>(requestObject);
    size_t routerIndexValue = static_cast<size_t>(routerIndex.asInt32());

    // What we need:
    // 1. `routerTypeMain: string` (module specifier for serverEntrypoint)
    // 2. `routeModules: string[]` (module specifiers for `[pageModule, ...layoutModules]`)
    // 3. `styles: string[]`       (CSS URLs to be given to react to render)
    // 4. `clientEntryUrl: string` (client script to be given to react to render)

    EncodedJSValue routerTypeMain;
    EncodedJSValue routeModules;
    EncodedJSValue clientEntryUrl;
    EncodedJSValue styles;

    int success = Bun__BakeProductionSSRRouteInfo__dataForInitialization(globalObject, request->m_ctx, routerIndexValue, &routerTypeMain, &routeModules, &clientEntryUrl, &styles);
    RETURN_IF_EXCEPTION(scope, {});
    if (success == 0) {
        return JSValue::encode(JSC::jsUndefined());
    }

    auto* array = JSArray::create(globalObject->vm(), globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), 4);
    array->putDirectIndex(globalObject, 0, JSValue::decode(routerTypeMain));
    array->putDirectIndex(globalObject, 1, JSValue::decode(routeModules));
    array->putDirectIndex(globalObject, 2, JSValue::decode(clientEntryUrl));
    array->putDirectIndex(globalObject, 3, JSValue::decode(styles));

    return JSValue::encode(array);
}

// The purpose of this type is to store and cache the "params" object structures for each route. This is
//    done in a similar manner as ServerRouteList and is directly inspired by it.
class BakeProductionSSRRouteList final : public JSC::JSDestructibleObject {
private:
    // Two things to note:
    // 1. JSC imposes an upper bound of 64 properties
    // 2. We can't mix and match keys and indices (user can't make a route param that is named as a number)
    WTF::FixedVector<WriteBarrier<Structure>> m_paramsObjectStructures;

public:
    using Base = JSC::JSDestructibleObject;

    BakeProductionSSRRouteList(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, size_t routeCount)
        : Base(vm, structure)
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
        for (size_t i = 0; i < m_paramsObjectStructures.size(); i++) {
            m_paramsObjectStructures[i].setMayBeNull(vm, this, nullptr);
        }
    }

    Structure* routeParamsStructure(size_t index) const
    {
        return m_paramsObjectStructures[index].get();
    }

    Structure* createRouteParamsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint32_t index, std::span<BunString> identifiers)
    {
        auto structure = JSC::Structure::create(vm, globalObject, globalObject->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, 0), JSFinalObject::info(), NonArray, identifiers.size());
        PropertyOffset offset = 0;
        for (const auto& identifier : identifiers) {
            structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, identifier.toWTFString()), 0, offset);
        }
        this->m_paramsObjectStructures[index].set(vm, this, structure);
        return structure;
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

    for (unsigned i = 0; i < thisCallSite->m_paramsObjectStructures.size(); i++) {
        if (thisCallSite->m_paramsObjectStructures[i]) visitor.append(thisCallSite->m_paramsObjectStructures[i]);
    }
}
DEFINE_VISIT_CHILDREN(BakeProductionSSRRouteList);

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__getProdDataForInitializationJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(zig->bakeAdditions().m_bakeGetProdDataForInitializationJSFunction.get(globalObject));
}

extern "C" JSC::EncodedJSValue Bun__BakeProductionSSRRouteList__create(Zig::GlobalObject* globalObject, size_t routeCount)
{
    auto* routeList = BakeProductionSSRRouteList::create(globalObject->vm(), globalObject, routeCount);
    return JSValue::encode(routeList);
}

extern "C" JSC::EncodedJSValue Bun__BakeProductionSSRRouteList__createRouteParamsStructure(Zig::GlobalObject* globalObject, EncodedJSValue routeListObject, size_t index, BunString* paramsInfo, size_t paramsCount)
{
    BakeProductionSSRRouteList* routeList = jsCast<BakeProductionSSRRouteList*>(JSValue::decode(routeListObject));
    std::span<BunString> paramsInfoSpan(paramsInfo, paramsCount);
    auto* structure = routeList->createRouteParamsStructure(globalObject->vm(), globalObject, index, paramsInfoSpan);
    return JSValue::encode(structure);
}

extern "C" JSC::EncodedJSValue Bun__BakeProductionSSRRouteList__getRouteParamsStructure(Zig::GlobalObject* globalObject, EncodedJSValue routeListObject, size_t index)
{
    BakeProductionSSRRouteList* routeList = jsCast<BakeProductionSSRRouteList*>(JSValue::decode(routeListObject));
    auto* structure = routeList->routeParamsStructure(index);
    if (!structure) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(structure);
}

}
