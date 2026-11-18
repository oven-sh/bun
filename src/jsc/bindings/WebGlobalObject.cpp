#include "root.h"

#include "WebGlobalObject.h"

#include "Bindgen/JSGlobalStandIn.h"
#include "Bindgen/InterfaceLookup.h"
#include "Bindgen/JSInterface.h"
#include "BunClientData.h"
#include "BunCompiledModules.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "InternalModuleRegistry.h"
#include "DesktopRealm.h"
#include "IsolatedWorld.h"
#include "RemovableFeatures.h"
#include "ScriptExecutionContext.h"

#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/AOTModuleHost.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/Lookup.h>

#include "WebGlobalObject.names.h"

namespace Bun {

using namespace JSC;

namespace WebGlobals {

static_assert(std::size(sameObjectNames) <= 32);

static constexpr unsigned visibilityAttributes = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete;

static const HashTableValue& rowOf(JSObject* realm, PropertyName name)
{
    return *realm->structure()->findPropertyHashEntry(name)->value;
}

static bool isAsInTable(VM& vm, JSObject* realm, PropertyName name)
{
    unsigned attributes;
    JSValue held = realm->getDirect(vm, name, attributes);
    if (!realm->structure()->findPropertyHashEntry(name))
        return false;
    if (!held)
        return !realm->staticPropertiesReified();
    return attributes & PropertyAttribute::CustomAccessorOrValue && uncheckedDowncast<CustomGetterSetter>(held)->getter() == rowOf(realm, name).propertyGetter();
}

static EncodedJSValue reify(VM& vm, JSObject* realm, PropertyName name, JSValue value)
{
    if (isAsInTable(vm, realm, name)) {
        AllowLazyMaterializationOfImmutableProperties allowMaterialization(vm);
        realm->putDirect(vm, name, value, rowOf(realm, name).attributes() & visibilityAttributes);
    }
    return JSValue::encode(value);
}

static JSGlobalObject* realmOf(JSObject* holder) { return holder->structure()->realm(); }

static JSValue receiverOf(JSGlobalObject* realm, EncodedJSValue encoded)
{
    JSValue receiver = JSValue::decode(encoded);
    if (receiver.isUndefinedOrNull())
        return realm->globalThis();
    if (receiver.isObject() && asObject(receiver)->isGlobalObject())
        return uncheckedDowncast<JSGlobalObject>(receiver)->globalThis();
    return receiver;
}

static JSC_DECLARE_CUSTOM_GETTER(loadNative);
static JSC_DECLARE_CUSTOM_GETTER(loadPrefixedNative);
static JSC_DECLARE_CUSTOM_GETTER(loadEmptyObject);
static JSC_DECLARE_CUSTOM_GETTER(loadInterface);
static JSC_DECLARE_CUSTOM_GETTER(loadMember);
static JSC_DECLARE_CUSTOM_GETTER(loadInherited);

JSC_DEFINE_CUSTOM_GETTER(loadNative, (JSGlobalObject*, EncodedJSValue encodedHolder, PropertyName name))
{
    auto* holder = asObject(JSValue::decode(encodedHolder));
    auto* realm = realmOf(holder);
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = uncheckedDowncast<Zig::GlobalObject>(realm)->natives()->get(realm, name);
    RETURN_IF_EXCEPTION(scope, {});
    return reify(vm, holder, name, value);
}

JSC_DEFINE_CUSTOM_GETTER(loadPrefixedNative, (JSGlobalObject*, EncodedJSValue encodedHolder, PropertyName name))
{
    auto* holder = asObject(JSValue::decode(encodedHolder));
    auto* realm = realmOf(holder);
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = uncheckedDowncast<Zig::GlobalObject>(realm)->natives()->get(realm, Identifier::fromString(vm, String(name.uid()).substring("webkit"_s.length())));
    RETURN_IF_EXCEPTION(scope, {});
    return reify(vm, holder, name, value);
}

JSC_DEFINE_CUSTOM_GETTER(loadEmptyObject, (JSGlobalObject*, EncodedJSValue encodedHolder, PropertyName name))
{
    auto* holder = asObject(JSValue::decode(encodedHolder));
    auto* realm = realmOf(holder);
    return reify(realm->vm(), holder, name, constructEmptyObject(realm));
}

JSC_DEFINE_CUSTOM_GETTER(loadInterface, (JSGlobalObject*, EncodedJSValue encodedHolder, PropertyName name))
{
    auto* holder = asObject(JSValue::decode(encodedHolder));
    auto* realm = realmOf(holder);
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = Bindgen::interfaceObjectNamed(realm, *name.uid());
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(value.isObject());
    return reify(vm, holder, name, value);
}

JSC_DEFINE_CUSTOM_GETTER(loadMember, (JSGlobalObject*, EncodedJSValue encodedHolder, PropertyName name))
{
    auto* holder = asObject(JSValue::decode(encodedHolder));
    auto* realm = uncheckedDowncast<WebGlobalObject>(realmOf(holder));
    JSValue value = realm->members()->getDirect(realm->vm(), name);
    return reify(realm->vm(), holder, name, value ? value : jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(loadInherited, (JSGlobalObject*, EncodedJSValue encodedHolder, PropertyName name))
{
    auto* holder = asObject(JSValue::decode(encodedHolder));
    auto* realm = realmOf(holder);
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = asObject(holder->getPrototypeDirect())->get(realm, name);
    RETURN_IF_EXCEPTION(scope, {});
    return reify(vm, holder, name, value);
}

static NEVER_INLINE EncodedJSValue getAndRemember(unsigned index, GetValueFunc getter, JSGlobalObject* realm, EncodedJSValue receiver, PropertyName name)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    EncodedJSValue value = getter(realm, receiver, name);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue object = receiverOf(realm, receiver);
    auto* ofTheWeb = dynamicDowncast<WebGlobalObject>(realm);
    if (ofTheWeb && object == realm->globalThis() && uncheckedDowncast<JSGlobalProxy>(object)->target() == realm && isAsInTable(vm, realm, name))
        ofTheWeb->rememberSameObject(vm, index, name, JSValue::decode(value));
    return value;
}

template<unsigned index, auto getter>
static EncodedJSValue JIT_OPERATION_ATTRIBUTES getSameObject(JSGlobalObject* realm, EncodedJSValue receiver, PropertyName name)
{
    return getAndRemember(index, getter, realm, receiver, name);
}

#include "WebGlobalObject.lut.h"

} // namespace WebGlobals

extern "C" EncodedJSValue Bun__WebGlobalObject__callNative(Zig::GlobalObject* realm, const char* name, EncodedJSValue argument)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue function = realm->natives()->get(realm, Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(name)));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(call(realm, function, getCallData(function), jsUndefined(), ArgList(&argument, 1))));
}

using namespace WebGlobals;

const ClassInfo WebGlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(WebGlobalObject) };

#define FOR_EACH_WEB_GLOBAL_INFO(macro)                                                                                                                               \
    macro(everywhere, "GlobalObject", s_info, everywhereTable)                                                                                                        \
        macro(document, "Window", everywhere, documentTable)                                                                                                          \
            macro(window, "Window", document, windowTable)                                                                                                            \
                macro(preloadWindow, "Window", window, nodeTable)                                                                                                     \
                    macro(nodeWindow, "Window", preloadWindow, nodeIntegrationTable)                                                                                  \
                        macro(secureWindowBase, "Window", window, secureTable)                                                                                        \
                            macro(secureWindow, "Window", secureWindowBase, secureWindowTable)                                                                        \
                                macro(securePreloadWindow, "Window", secureWindow, nodeTable)                                                                         \
                                    macro(secureNodeWindow, "Window", securePreloadWindow, nodeIntegrationTable)                                                      \
                                        macro(worker, "WorkerGlobalScope", everywhere, workerTable)                                                                   \
                                            macro(dedicatedWorker, "DedicatedWorkerGlobalScope", worker, dedicatedWorkerTable)                                        \
                                                macro(secureDedicatedWorkerBase, "DedicatedWorkerGlobalScope", dedicatedWorker, secureTable)                          \
                                                    macro(secureDedicatedWorker, "DedicatedWorkerGlobalScope", secureDedicatedWorkerBase, secureDedicatedWorkerTable) \
                                                        macro(sharedWorker, "SharedWorkerGlobalScope", worker, sharedWorkerTable)                                     \
                                                            macro(secureSharedWorker, "SharedWorkerGlobalScope", sharedWorker, secureTable)                           \
                                                                macro(documentOfProgram, "Window", s_infoWithBunGlobals, documentTable)                               \
                                                                    macro(windowOfProgram, "Window", documentOfProgram, windowOfProgramTable)

struct WebGlobalObject::ClassInfos {
#define DECLARE_WEB_GLOBAL_INFO(name, className, parent, table) static const ClassInfo name;
    FOR_EACH_WEB_GLOBAL_INFO(DECLARE_WEB_GLOBAL_INFO)
#undef DECLARE_WEB_GLOBAL_INFO
};

#define DEFINE_WEB_GLOBAL_INFO(name, className, parent, table) \
    const ClassInfo WebGlobalObject::ClassInfos::name = { className##_s, &parent, &table, nullptr, CREATE_METHOD_TABLE(WebGlobalObject) };
FOR_EACH_WEB_GLOBAL_INFO(DEFINE_WEB_GLOBAL_INFO)
#undef DEFINE_WEB_GLOBAL_INFO
#undef FOR_EACH_WEB_GLOBAL_INFO

using ClassInfos = WebGlobalObject::ClassInfos;

static void forEachTableOfPlatform(JSObject* window, NOESCAPE const auto& callback)
{
    for (auto* info = window->classInfo(); info && info != WebGlobalObject::info() && info != &WebGlobalObject::s_infoWithBunGlobals; info = info->parentClass) {
        if (auto* table = info->staticPropHashTable; table && table != &nodeTable && table != &nodeIntegrationTable)
            callback(*table);
    }
}

const HashTableValue* WebGlobalObject::rowOfPlatform(JSObject* window, PropertyName name)
{
    const HashTableValue* row = nullptr;
    forEachTableOfPlatform(window, [&](const HashTable& table) { row = row ? row : table.entry(name); });
    return row;
}

// It gets the names that the window of its page has when they are looked up.
class IsolatedWorldGlobalObject final : public WebGlobalObject {
public:
    static const ClassInfo plain;
    static const ClassInfo ofPreload;
    static const ClassInfo ofNodeIntegration;

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        if (auto index = parseIndex(name))
            return getOwnPropertySlotByIndex(object, globalObject, *index, slot);
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        if (slot.isVMInquiry())
            slot.setIsTaintedByOpaqueObject();
        else
            define(object, name);
        RETURN_IF_EXCEPTION(scope, false);
        RELEASE_AND_RETURN(scope, WebGlobalObject::getOwnPropertySlot(object, globalObject, name, slot));
    }

    static bool getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        slot.disableCaching();
        if (slot.isVMInquiry()) {
            slot.setIsTaintedByOpaqueObject();
            return false;
        }
        JSValue frame = IsolatedWorld::frameAt(uncheckedDowncast<JSGlobalObject>(object), index);
        RETURN_IF_EXCEPTION(scope, false);
        if (frame)
            slot.setValue(object, static_cast<unsigned>(PropertyAttribute::ReadOnly), frame);
        return !!frame;
    }

    static bool put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        define(cell, name);
        RETURN_IF_EXCEPTION(scope, false);
        RELEASE_AND_RETURN(scope, WebGlobalObject::put(cell, globalObject, name, value, slot));
    }

    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        define(object, name);
        RETURN_IF_EXCEPTION(scope, false);
        RELEASE_AND_RETURN(scope, WebGlobalObject::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow));
    }

    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot)
    {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        bool isOfPage = define(cell, name);
        RETURN_IF_EXCEPTION(scope, false);
        bool didDelete = WebGlobalObject::deleteProperty(cell, globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, false);
        if (didDelete && isOfPage)
            IsolatedWorld::deletedGlobalsOf(uncheckedDowncast<JSGlobalObject>(cell))->putDirect(vm, name, jsUndefined());
        return didDelete;
    }

    static void getOwnSpecialPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
    {
        VM& vm = globalObject->vm();
        auto* world = uncheckedDowncast<WebGlobalObject>(object);
        WebGlobalObject::getOwnSpecialPropertyNames(object, globalObject, names, mode);
        auto* page = IsolatedWorld::pageOf(world);
        if (!page || !names.includeStringProperties())
            return;
        forEachTableOfPlatform(page, [&](const HashTable& table) {
            for (auto it = table.begin(); it != table.end(); ++it) {
                auto name = Identifier::fromString(vm, it.key());
                bool isListed = mode == DontEnumPropertiesMode::Include || !(it->attributes() & PropertyAttribute::DontEnum);
                if (isListed && !world->getDirect(vm, name) && !IsolatedWorld::deletedGlobalsOf(world)->getDirect(vm, name))
                    names.add(name);
            }
        });
    }

private:
    // Whether the page has a row for the name.
    static bool define(JSCell* cell, PropertyName name)
    {
        VM& vm = cell->vm();
        auto* world = uncheckedDowncast<WebGlobalObject>(cell);
        auto* page = name.isSymbol() ? nullptr : IsolatedWorld::pageOf(world);
        auto* row = page ? rowOfPlatform(page, name) : nullptr;
        if (!row)
            return false;
        JSValue held = world->getDirect(vm, name);
        auto* accessor = held ? dynamicDowncast<CustomGetterSetter>(held) : nullptr;
        if ((held && !(accessor && accessor->getter() == row->propertyGetter())) || IsolatedWorld::deletedGlobalsOf(world)->getDirect(vm, name) || world->symbolTable()->contains(name.uid()))
            return true;
        auto scope = DECLARE_THROW_SCOPE(vm);
        bool isNative = row->attributes() & PropertyAttribute::CustomValue && row->propertyGetter() == loadNative;
        JSObject* members = world->members();
        if (!isNative && !members->getDirect(vm, name)) {
            scope.release();
            IsolatedWorld::defineGlobal(world, name, *row);
            return true;
        }
        JSValue own = (isNative ? world->natives() : members)->get(world, name);
        RETURN_IF_EXCEPTION(scope, true);
        AllowLazyMaterializationOfImmutableProperties allowMaterialization(vm);
        world->putDirect(vm, name, own, row->attributes() & visibilityAttributes);
        return true;
    }
};

const ClassInfo IsolatedWorldGlobalObject::plain = { "Window"_s, &ClassInfos::everywhere, nullptr, nullptr, CREATE_METHOD_TABLE(IsolatedWorldGlobalObject) };
const ClassInfo IsolatedWorldGlobalObject::ofPreload = { "Window"_s, &plain, &nodeTable, nullptr, CREATE_METHOD_TABLE(IsolatedWorldGlobalObject) };
const ClassInfo IsolatedWorldGlobalObject::ofNodeIntegration = { "Window"_s, &ofPreload, &nodeIntegrationTable, nullptr, CREATE_METHOD_TABLE(IsolatedWorldGlobalObject) };

static const ClassInfo* classInfoOf(WebGlobalObject::Kind kind)
{
    if (kind.isIsolatedWorld) {
        static constexpr const ClassInfo* byNodeGlobals[] = { &IsolatedWorldGlobalObject::plain, &IsolatedWorldGlobalObject::ofPreload, &IsolatedWorldGlobalObject::ofNodeIntegration };
        return byNodeGlobals[static_cast<unsigned>(kind.nodeGlobals)];
    }
    switch (kind.scope) {
    case WebGlobalObject::Scope::DedicatedWorker:
        return kind.isSecureContext ? &ClassInfos::secureDedicatedWorker : &ClassInfos::dedicatedWorker;
    case WebGlobalObject::Scope::SharedWorker:
        return kind.isSecureContext ? &ClassInfos::secureSharedWorker : &ClassInfos::sharedWorker;
    case WebGlobalObject::Scope::Window:
        break;
    }
    switch (kind.nodeGlobals) {
    case WebGlobalObject::NodeGlobals::None:
        return kind.isSecureContext ? &ClassInfos::secureWindow : &ClassInfos::window;
    case WebGlobalObject::NodeGlobals::OfPreload:
        return kind.isSecureContext ? &ClassInfos::securePreloadWindow : &ClassInfos::preloadWindow;
    case WebGlobalObject::NodeGlobals::OfNodeIntegration:
        return kind.isSecureContext ? &ClassInfos::secureNodeWindow : &ClassInfos::nodeWindow;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

GCClient::IsoSubspace* WebGlobalObject::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<WebGlobalObject, WebCore::UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForWebGlobalObject, m_subspaceForWebGlobalObject));
}

extern "C" void* Bun__WebRealm__create(JSGlobalObject*, WebGlobalObject::Scope, bool isSecureContext, bool isCrossOriginIsolated);
extern "C" void Bun__WebRealm__destroy(void*);

extern "C" void* Bun__WebGlobalObject__realm(JSGlobalObject* globalObject)
{
    if (globalObject->methodTable()->destroy != &WebGlobalObject::destroy)
        return nullptr;
    return static_cast<WebGlobalObject*>(globalObject)->realm();
}

extern "C" EncodedJSValue Bun__WebGlobalObject__globalThis(JSGlobalObject* globalObject)
{
    return JSValue::encode(globalObject->globalThis());
}

WebGlobalObject::~WebGlobalObject()
{
    JSC::callRemovable<Bun::Feature::Desktop, JSC::RemovedFeatureStub::Abort, Bun__WebRealm__destroy>(m_realm);
}

WebGlobalObject::WebGlobalObject(VM& vm, Structure* structure, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable* methodTable)
    : Base(vm, structure, scriptExecutionContextId, methodTable)
{
}

WebGlobalObject* WebGlobalObject::create(VM& vm, const ClassInfo* classInfo, Kind kind, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable* methodTable)
{
    auto* structure = Structure::create(vm, nullptr, jsNull(), TypeInfo(GlobalObjectType, (StructureFlags & ~IsImmutablePrototypeExoticObject) | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero), classInfo);
    structure->setTransitionWatchpointIsLikelyToBeFired(true);
    auto* realm = new (NotNull, allocateCell<WebGlobalObject>(vm)) WebGlobalObject(vm, structure, scriptExecutionContextId, methodTable);
    static constexpr uint8_t exposures[] = { Bindgen::Exposure::Window, Bindgen::Exposure::DedicatedWorker, Bindgen::Exposure::SharedWorker };
    realm->m_bindgenAdditions.m_exposure = exposures[static_cast<unsigned>(kind.scope)] | (kind.isSecureContext ? Bindgen::Exposure::SecureContext : 0);
    realm->m_realm = Bun__WebRealm__create(realm, kind.scope, kind.isSecureContext, kind.isCrossOriginIsolated);
    realm->finishCreation(vm);
    if (kind.scope == Scope::Window && !kind.isIsolatedWorld)
        realm->adoptPrototype(vm, "Window"_s);
    return realm;
}

WebGlobalObject* WebGlobalObject::create(VM& vm, Kind kind, const JSC::GlobalObjectMethodTable* methodTable)
{
    return create(vm, classInfoOf(kind), kind, WebCore::ScriptExecutionContext::generateIdentifier(), methodTable);
}

static bool startsInWindow = false;

extern "C" void Bun__startInWindow()
{
    startsInWindow = true;
}

bool WebGlobalObject::programStartsInWindow()
{
    return startsInWindow;
}

NEVER_INLINE WebGlobalObject* WebGlobalObject::createForProgram(VM& vm, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable& ofProgram)
{
    BUN_REMOVABLE_DEFINITION(Desktop, &WebGlobalObject::createForProgram);
    static const JSC::GlobalObjectMethodTable methodTable = [&] {
        JSC::GlobalObjectMethodTable table = ofProgram;
#if ENABLE(AOT)
        if (table.moduleHost)
            table.moduleHost = &moduleHost();
#endif
        return table;
    }();
    Bindgen::setGlobalReceiverInitializer([](Zig::GlobalObject* realm) {
        if (realm->classInfo() == &ClassInfos::windowOfProgram)
            uncheckedDowncast<WebGlobalObject>(realm)->members();
    });
    return create(vm, &ClassInfos::windowOfProgram, { Scope::Window, true, false, NodeGlobals::None }, scriptExecutionContextId, &methodTable);
}

static JSValue prototypeOfInterface(JSGlobalObject* realm, ASCIILiteral name)
{
    VM& vm = realm->vm();
    return asObject(Bindgen::interfaceObjectNamed(realm, *Identifier::fromString(vm, name).impl()))->getDirect(vm, vm.propertyNames->prototype);
}

JSObject* desktopRealmInterface(JSGlobalObject* realm, ASCIILiteral name)
{
    if (!isDesktopRealm(realm) && !realm->classInfo()->isSubClassOf(&WebGlobalObject::s_infoWithBunGlobals)) [[likely]]
        return nullptr;
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, JSObject*)
    if (realm->classInfo()->isSubClassOf(&IsolatedWorldGlobalObject::plain))
        return nullptr;
    return asObject(Bindgen::interfaceObjectNamed(realm, *Identifier::fromString(realm->vm(), name).impl()));
    BUN_END_REMOVABLE_ENTRY_POINT
}

JSObject* desktopRealmPrototypeAbove(JSGlobalObject* realm, ASCIILiteral name)
{
    auto* interface = desktopRealmInterface(realm, name);
    return interface ? asObject(interface->getDirect(realm->vm(), realm->vm().propertyNames->prototype)) : realm->objectPrototype();
}

void WebGlobalObject::adoptPrototype(VM& vm, ASCIILiteral interface)
{
    JSValue prototype = prototypeOfInterface(this, interface);
    setPrototypeDirect(vm, prototype);
    globalThis()->setPrototypeDirect(vm, prototype);
}

JSObject* WebGlobalObject::members()
{
    if (m_members) [[likely]]
        return m_members.get();
    auto scope = DECLARE_THROW_SCOPE(vm());
    if (classInfo() == &ClassInfos::windowOfProgram) {
        BUN_LOAD_INTERNAL_MODULE(this, BunDesktopDom, "%WindowOfProgram%");
        RETURN_IF_EXCEPTION(scope, nullptr);
        return m_members.get();
    }
    throwTypeError(this, scope, "Illegal invocation"_s);
    return nullptr;
}

void WebGlobalObject::setMembers(VM& vm, JSObject* members)
{
    m_members.set(vm, this, members);
    if (!classInfo()->isSubClassOf(&ClassInfos::worker))
        return;
    adoptPrototype(vm, classInfo()->className);
}

#if ENABLE(AOT)
static JSObject* holderOfGlobal(JSGlobalObject* globalObject, UniquedStringImpl* name)
{
    auto* realm = uncheckedDowncast<WebGlobalObject>(globalObject);
    if (!WebGlobalObject::isNameOfNative(realm->vm(), name))
        return realm;
    bool isShown = realm->classInfo() == &ClassInfos::windowOfProgram && !documentTable.entry(PropertyName(name)) && !windowOfProgramTable.entry(PropertyName(name));
    return isShown ? realm : realm->natives();
}

const AOT::ModuleHost& WebGlobalObject::moduleHost()
{
    static const AOT::ModuleHost host = [] {
        AOT::ModuleHost host = compiledModuleHost;
        host.holderOfGlobal = &holderOfGlobal;
        host.tableOfGlobals = s_infoWithBunGlobals.staticPropHashTable;
        return host;
    }();
    return host;
}
#endif

void WebGlobalObject::destroy(JSCell* cell)
{
    static_cast<WebGlobalObject*>(cell)->WebGlobalObject::~WebGlobalObject();
}

template<typename Visitor>
void WebGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* realm = uncheckedDowncast<WebGlobalObject>(cell);
    Base::visitChildren(realm, visitor);
    visitor.append(realm->m_members);
}

DEFINE_VISIT_CHILDREN(WebGlobalObject);

static std::optional<unsigned> sameObjectIndexOf(uint32_t among, PropertyName name)
{
    for (; among; among &= among - 1) {
        unsigned index = std::countr_zero(among);
        if (WTF::equal(name.uid(), sameObjectNames[index]))
            return index;
    }
    return std::nullopt;
}

void WebGlobalObject::rememberSameObject(VM& vm, unsigned index, PropertyName name, JSValue value)
{
    AllowLazyMaterializationOfImmutableProperties allowMaterialization(vm);
    putDirect(vm, name, value, PropertyAttribute::ReadOnly | (rowOf(this, name).attributes() & visibilityAttributes));
    m_rememberedObjects |= 1u << index;
}

// A function declaration in a script replaces the property without a word, and leaves it writable.
const HashTableValue* WebGlobalObject::rowOfRememberedObject(VM& vm, PropertyName name)
{
    if (!m_rememberedObjects || name.isSymbol())
        return nullptr;
    unsigned attributes;
    if (!isValidOffset(getDirectOffset(vm, name, attributes)) || !(attributes & PropertyAttribute::ReadOnly) || attributes & PropertyAttribute::CustomAccessor)
        return nullptr;
    return sameObjectIndexOf(m_rememberedObjects, name) ? &rowOf(this, name) : nullptr;
}

void WebGlobalObject::forget(VM& vm, PropertyName name, const HashTableValue& row)
{
    m_rememberedObjects &= ~(1u << *sameObjectIndexOf(m_rememberedObjects, name));
    auto* accessor = CustomGetterSetter::create(vm, row.propertyGetter(), row.propertyPutter());
    Structure* before = structure();
    PropertyOffset offset = getDirectOffset(vm, name);
    before->didReplaceProperty(offset);
    putDirectOffset(vm, offset, accessor);
    DeferredStructureTransitionWatchpointFire deferred(vm, before);
    JSObject::setStructure(vm, Structure::attributeChangeTransition(vm, before, name, attributesForStructure(row.attributes()), &deferred));
    if (mayBePrototype())
        vm.invalidateStructureChainIntegrity(VM::StructureChainIntegrityEvent::Change, this, name.uid());
}

void WebGlobalObject::forgetSameObjects(VM& vm)
{
    for (uint32_t left = m_rememberedObjects; left; left &= left - 1) {
        auto name = Identifier::fromString(vm, sameObjectNames[std::countr_zero(left)]);
        if (auto* row = rowOfRememberedObject(vm, name))
            forget(vm, name, *row);
    }
    m_rememberedObjects = 0;
}

// https://html.spec.whatwg.org/#the-windowproxy-exotic-object
extern "C" uint32_t Bun__DOM__frameCount(JSGlobalObject*, EncodedJSValue window);
extern "C" EncodedJSValue Bun__DOM__windowOfFrame(JSGlobalObject*, EncodedJSValue window, uint32_t index);

static bool isWindow(JSCell* realm) { return uncheckedDowncast<WebGlobalObject>(realm)->m_bindgenAdditions.m_exposure & Bindgen::Exposure::Window; }

static uint32_t frameCount(JSCell* window, JSGlobalObject* globalObject)
{
    auto* realm = dynamicDowncast<JSGlobalObject>(window);
    auto* page = realm ? IsolatedWorld::pageOf(realm) : nullptr;
    return Bun__DOM__frameCount(globalObject, JSValue::encode(page ? page : window));
}

static bool getFrame(JSObject* window, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    slot.disableCaching();
    if (slot.isVMInquiry()) {
        slot.setIsTaintedByOpaqueObject();
        return false;
    }
    JSValue frame = JSValue::decode(Bun__DOM__windowOfFrame(globalObject, JSValue::encode(window), index));
    if (frame)
        slot.setValue(window, static_cast<unsigned>(PropertyAttribute::ReadOnly), frame);
    return !!frame;
}

static bool refuseIndex(JSGlobalObject* globalObject, bool shouldThrow)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return typeError(globalObject, scope, shouldThrow, "The indices of a window are those of its frames."_s);
}

static void addIndicesOfFrames(JSObject* window, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names)
{
    for (uint32_t index = 0, count = frameCount(window, globalObject); index < count; index++)
        names.add(Identifier::from(globalObject->vm(), index));
}

bool WebGlobalObject::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    return isWindow(object) ? getFrame(object, globalObject, index, slot) : Base::getOwnPropertySlotByIndex(object, globalObject, index, slot);
}

bool WebGlobalObject::setPrototype(JSObject* object, JSGlobalObject* globalObject, JSValue prototype, bool shouldThrow)
{
    if (!isDesktopRealm(uncheckedDowncast<JSGlobalObject>(object)))
        return Base::setPrototype(object, globalObject, prototype, shouldThrow);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return prototype == object->getPrototypeDirect() || typeError(globalObject, scope, shouldThrow, "Cannot set prototype of immutable prototype object"_s);
}

bool WebGlobalObject::preventExtensions(JSObject* object, JSGlobalObject* globalObject)
{
    return !isWindow(object) && Base::preventExtensions(object, globalObject);
}

bool WebGlobalObject::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    return isWindow(cell) ? refuseIndex(globalObject, shouldThrow) : Base::putByIndex(cell, globalObject, index, value, shouldThrow);
}

bool WebGlobalObject::deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index)
{
    return isWindow(cell) ? index >= frameCount(cell, globalObject) : Base::deletePropertyByIndex(cell, globalObject, index);
}

void WebGlobalObject::getOwnSpecialPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    addIndicesOfFrames(object, globalObject, names);
    Base::getOwnSpecialPropertyNames(object, globalObject, names, mode);
}

// It has too many properties not to be a dictionary, and inline caches pass over the accessors that a dictionary only has in a table.
static bool reifyAccessor(VM& vm, JSObject* realm, PropertyName name)
{
    auto entry = realm->structure()->hasNonReifiedStaticProperties() ? realm->structure()->findPropertyHashEntry(name) : std::nullopt;
    if (!entry || !(entry->value->attributes() & PropertyAttribute::CustomAccessor))
        return false;
    reifyStaticProperty(vm, entry->table->classForThis, name, *entry->value, *realm);
    return true;
}

bool WebGlobalObject::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
{
    if (auto index = parseIndex(name)) [[unlikely]]
        return getOwnPropertySlotByIndex(object, globalObject, *index, slot);
    if (slot.internalMethodType() == PropertySlot::InternalMethodType::GetOwnProperty) {
        if (auto* row = uncheckedDowncast<WebGlobalObject>(object)->rowOfRememberedObject(globalObject->vm(), name)) {
            slot.setCustom(object, attributesForStructure(row->attributes()), row->propertyGetter(), row->propertyPutter());
            return true;
        }
    }
    if (!Base::getOwnPropertySlot(object, globalObject, name, slot))
        return false;
    bool isOnlyInTable = slot.internalMethodType() == PropertySlot::InternalMethodType::Get && slot.isCacheableCustom() && !isValidOffset(slot.cachedOffset());
    return !isOnlyInTable || !reifyAccessor(globalObject->vm(), object, name) || Base::getOwnPropertySlot(object, globalObject, name, slot);
}

bool WebGlobalObject::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
{
    if (auto index = parseIndex(name); index && isWindow(cell)) [[unlikely]]
        return refuseIndex(globalObject, slot.isStrictMode());
    auto* realm = uncheckedDowncast<WebGlobalObject>(cell);
    auto* row = realm->rowOfRememberedObject(globalObject->vm(), name);
    if (row && row->propertyPutter())
        realm->forget(globalObject->vm(), name, *row);
    if (!isValidOffset(realm->getDirectOffset(globalObject->vm(), name)))
        reifyAccessor(globalObject->vm(), realm, name);
    return Base::put(cell, globalObject, name, value, slot);
}

bool WebGlobalObject::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    if (parseIndex(name) && isWindow(object))
        return refuseIndex(globalObject, shouldThrow);
    auto* realm = uncheckedDowncast<WebGlobalObject>(object);
    if (auto* row = realm->rowOfRememberedObject(globalObject->vm(), name))
        realm->forget(globalObject->vm(), name, *row);
    return Base::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow);
}

bool WebGlobalObject::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot)
{
    if (auto index = parseIndex(name))
        return deletePropertyByIndex(cell, globalObject, *index);
    auto* realm = uncheckedDowncast<WebGlobalObject>(cell);
    if (auto* row = realm->rowOfRememberedObject(globalObject->vm(), name))
        realm->forget(globalObject->vm(), name, *row);
    return Base::deleteProperty(cell, globalObject, name, slot);
}

// A window whose scripts are those of the program. What it lacks is the global object's.
class OtherWindow : public Bindgen::JSGlobalStandIn {
public:
    using Base = Bindgen::JSGlobalStandIn;
    using Base::Base;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable | OverridesGetOwnPropertySlot | GetOwnPropertySlotIsImpureForPropertyAbsence | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | OverridesGetOwnSpecialPropertyNames;
    static const ClassInfo s_infoOfDocument;
    DECLARE_INFO;

    static OtherWindow* create(VM& vm, JSGlobalObject* realm)
    {
        auto* structure = Structure::create(vm, realm, prototypeOfInterface(realm, "Window"_s), TypeInfo(ObjectType, StructureFlags), info());
        auto* window = new (NotNull, allocateCell<OtherWindow>(vm)) OtherWindow(vm, structure);
        window->finishCreation(vm);
        return window;
    }

    static bool getOwnPropertySlotByIndex(JSObject* window, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot) { return getFrame(window, globalObject, index, slot); }
    static void getOwnSpecialPropertyNames(JSObject* window, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode) { addIndicesOfFrames(window, globalObject, names); }

    static bool getOwnPropertySlot(JSObject* window, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        if (auto index = parseIndex(name))
            return getFrame(window, globalObject, *index, slot);
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        bool isOwn = Base::getOwnPropertySlot(window, globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, false);
        if (isOwn || name.isSymbol() || slot.isVMInquiry())
            return isOwn;
        JSValue value = window;
        if (name != vm.propertyNames->globalThis) {
            auto* realm = realmOf(window);
            PropertySlot ofRealm(realm->globalThis(), PropertySlot::InternalMethodType::Get);
            bool isGlobal = realm->methodTable()->getOwnPropertySlot(realm, globalObject, name, ofRealm);
            RETURN_IF_EXCEPTION(scope, false);
            if (!isGlobal)
                return false;
            value = ofRealm.getValue(globalObject, name);
            RETURN_IF_EXCEPTION(scope, false);
        }
        slot.disableCaching();
        slot.setValue(window, static_cast<unsigned>(PropertyAttribute::DontEnum), value);
        return true;
    }
};
const ClassInfo OtherWindow::s_infoOfDocument = { "Window"_s, &Base::s_info, &documentTable, nullptr, CREATE_METHOD_TABLE(OtherWindow) };
const ClassInfo OtherWindow::s_info = { "Window"_s, &s_infoOfDocument, &windowOfProgramTable, nullptr, CREATE_METHOD_TABLE(OtherWindow) };

extern "C" EncodedJSValue Bun__DOM__createOtherWindow(JSGlobalObject* realm)
{
    return JSValue::encode(OtherWindow::create(realm->vm(), realm));
}

} // namespace Bun
