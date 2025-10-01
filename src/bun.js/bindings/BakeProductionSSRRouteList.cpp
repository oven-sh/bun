#include "root.h"
#include "ZigGlobalObject.h"
#include "JSBunRequest.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

extern "C" int Bun__BakeProductionSSRRouteInfo__dataForInitialization(JSGlobalObject* globalObject, void* zigRequestPtr, size_t routerIndex, size_t routerTypeIndex, JSC::EncodedJSValue* routerTypeMain, JSC::EncodedJSValue* routeModules, JSC::EncodedJSValue* clientEntryUrl, JSC::EncodedJSValue* styles);

void createBakeProductionSSRRouteArgsStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto structure = JSC::Structure::create(init.vm, init.global, init.global->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, 0), JSFinalObject::info(), NonArray, 4);

    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "serverEntrypoint"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routeModules"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "styles"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "clientEntryUrl"_s), 0, offset);

    init.setPrototype(init.global->objectPrototype());
    init.setStructure(structure);
}

// Called by the production server runtime in JS to get the data to initialize the arguments for a route to render it
JSC_DEFINE_HOST_FUNCTION(jsBakeProductionSSRRouteInfoPrototypeFunction_dataForInitialization, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (callframe->argumentCount() < 3) {
        throwTypeError(globalObject, scope, "Expected 3 argument"_s);
        return {};
    }

    JSValue requestObject = callframe->argument(0);
    JSValue routerIndex = callframe->argument(1);
    JSValue routerTypeIndex = callframe->argument(2);

    if (requestObject.isEmpty() || requestObject.isUndefinedOrNull() || !requestObject.isCell()) {
        throwTypeError(globalObject, scope, "Expected first argument to be a non-empty object"_s);
        return {};
    }

    if (!routerIndex.isInt32()) {
        throwTypeError(globalObject, scope, "Expected second argument to be a number"_s);
        return {};
    }

    if (!routerTypeIndex.isInt32()) {
        throwTypeError(globalObject, scope, "Expected third argument to be a number"_s);
        return {};
    }

    JSBunRequest* request = jsCast<JSBunRequest*>(requestObject);
    size_t routerIndexValue = static_cast<size_t>(routerIndex.asInt32());
    size_t routerTypeIndexValue = static_cast<size_t>(routerTypeIndex.asInt32());

    // What we need:
    // 1. `routerTypeMain: string` (module specifier for serverEntrypoint)
    // 2. `routeModules: string[]` (module specifiers for `[pageModule, ...layoutModules]`)
    // 3. `styles: string[]`       (CSS URLs to be given to react to render)
    // 4. `clientEntryUrl: string` (client script to be given to react to render)

    EncodedJSValue routerTypeMain;
    EncodedJSValue routeModules;
    EncodedJSValue clientEntryUrl;
    EncodedJSValue styles;

    int success = Bun__BakeProductionSSRRouteInfo__dataForInitialization(globalObject, request->m_ctx, routerIndexValue, routerTypeIndexValue, &routerTypeMain, &routeModules, &clientEntryUrl, &styles);
    RETURN_IF_EXCEPTION(scope, {});
    if (success == 0) {
        return JSValue::encode(JSC::jsUndefined());
    }

    auto zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zig->bakeAdditions().m_BakeProductionSSRRouteArgsClassStructure.get(globalObject);
    auto* instance = constructEmptyObject(globalObject->vm(), structure);

    instance->putDirectOffset(globalObject->vm(), 0, JSValue::decode(routerTypeMain));
    instance->putDirectOffset(globalObject->vm(), 1, JSValue::decode(routeModules));
    instance->putDirectOffset(globalObject->vm(), 2, JSValue::decode(styles));
    instance->putDirectOffset(globalObject->vm(), 3, JSValue::decode(clientEntryUrl));

    return JSValue::encode(instance);
}

static const HashTableValue BakeProductionSSRRouteInfoPrototypeValues[] = {
    { "dataForInitialization"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBakeProductionSSRRouteInfoPrototypeFunction_dataForInitialization, 0 } },
};

// This prototype is needed to augment the RouteInfo object with a
// `dataForInitialization` function which returns the needed data to initialize
// the RouteInfo object
class BakeProductionSSRRouteInfoPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static BakeProductionSSRRouteInfoPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* prototype = new (NotNull, JSC::allocateCell<BakeProductionSSRRouteInfoPrototype>(vm)) BakeProductionSSRRouteInfoPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {

        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<BakeProductionSSRRouteInfoPrototype, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBakeProductionSSRRouteInfoPrototype.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBakeProductionSSRRouteInfoPrototype = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBakeProductionSSRRouteInfoPrototype.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBakeProductionSSRRouteInfoPrototype = std::forward<decltype(space)>(space); });
    }

private:
    BakeProductionSSRRouteInfoPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));

        reifyStaticProperties(vm, this->classInfo(), BakeProductionSSRRouteInfoPrototypeValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

template<typename Visitor>
void BakeProductionSSRRouteInfoPrototype::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    BakeProductionSSRRouteInfoPrototype* thisCallSite = jsCast<BakeProductionSSRRouteInfoPrototype*>(cell);
    Base::visitChildren(thisCallSite, visitor);
}
DEFINE_VISIT_CHILDREN(BakeProductionSSRRouteInfoPrototype);

const JSC::ClassInfo BakeProductionSSRRouteInfoPrototype::s_info = { "BakeProductionSSRRouteInfo"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(BakeProductionSSRRouteInfoPrototype) };

void createBakeProductionSSRRouteInfoStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototype = BakeProductionSSRRouteInfoPrototype::create(init.vm, init.global, BakeProductionSSRRouteInfoPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto structure = JSC::Structure::create(init.vm, init.global, prototype, JSC::TypeInfo(JSC::ObjectType, 0), JSFinalObject::info(), NonArray, 5);

    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "serverEntrypoint"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routeModules"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "styles"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "clientEntryUrl"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "initializing"_s), 0, offset);

    init.setPrototype(prototype);
    init.setStructure(structure);
}

JSFinalObject* createEmptyRouteInfoObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto zigGlobalObject = defaultGlobalObject(globalObject);
    auto* structure = zigGlobalObject->bakeAdditions().m_BakeProductionSSRRouteInfoClassStructure.get(zigGlobalObject);
    return constructEmptyObject(vm, structure);
}

// The purpose of this type is to:
// 1. Store and cache the "info" object for each route, this is an object which
//    represents the state needed to render a route. See the (`RouteInfo`) type in
//    `src/bake/production-runtime-server.ts`
//
//    This object contains things like the modules for the page, layouts, etc.
//    which could be costly to compute on every request, so we cache them here.
//
// 2. Store and cache the "params" object structures for each route. This is
//    done in a similar manner as ServerRouteList and is directly inspired by it.
class BakeProductionSSRRouteList final : public JSC::JSDestructibleObject {
private:
    WTF::FixedVector<WriteBarrier<JSC::JSFinalObject>> m_routeInfos;
    // Two things to note:
    // 1. JSC imposes an upper bound of 64 properties
    // 2. We can't mix and match keys and indices (user can't make a route param that is named as a number)
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
            auto* routeInfo = createEmptyRouteInfoObject(vm, globalObject);
            routeInfo->putDirectOffset(vm, 0, jsUndefined());
            routeInfo->putDirectOffset(vm, 1, jsUndefined());
            routeInfo->putDirectOffset(vm, 2, jsUndefined());
            routeInfo->putDirectOffset(vm, 3, jsUndefined());
            routeInfo->putDirectOffset(vm, 4, jsUndefined());

            m_routeInfos[i].setMayBeNull(vm, this, routeInfo);
            m_paramsObjectStructures[i].setMayBeNull(vm, this, nullptr);
        }
    }

    JSFinalObject* routeInfo(size_t index) const
    {
        return m_routeInfos[index].get();
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

    for (unsigned i = 0; i < thisCallSite->m_routeInfos.size(); i++) {
        if (thisCallSite->m_routeInfos[i]) visitor.append(thisCallSite->m_routeInfos[i]);
        if (thisCallSite->m_paramsObjectStructures[i]) visitor.append(thisCallSite->m_paramsObjectStructures[i]);
    }
}
DEFINE_VISIT_CHILDREN(BakeProductionSSRRouteList);

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

extern "C" JSC::EncodedJSValue Bun__BakeProductionSSRRouteList__getRouteInfo(Zig::GlobalObject* globalObject, EncodedJSValue routeListObject, size_t index)
{
    JSValue routeListValue = JSValue::decode(routeListObject);
    BakeProductionSSRRouteList* routeList = jsCast<BakeProductionSSRRouteList*>(routeListValue);
    JSValue routeInfo = routeList->routeInfo(index);
    return JSValue::encode(routeInfo);
}
}
