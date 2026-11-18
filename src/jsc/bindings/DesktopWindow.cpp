#include "root.h"

#include "DesktopWindow.h"

#include "IsolatedWorld.h"
#include "WebGlobalObject.h"

#include "Bindgen/JSGlobalStandIn.h"
#include "BunClientData.h"
#include "JSDOMExceptionHandling.h"

#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSGlobalProxyInlines.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/StackVisitor.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTCompiledFrame.h>
#include <JavaScriptCore/AOTFunctionDescription.h>
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/AOTVMState.h>
#endif

namespace Bun {

using namespace JSC;

extern "C" EncodedJSValue Bun__DOM__membersOfForeignObject(JSGlobalObject*, EncodedJSValue behind);
extern "C" EncodedJSValue Bun__DOM__childOfForeignObject(JSGlobalObject*, EncodedJSValue behind, EncodedJSValue key);

// https://html.spec.whatwg.org/#cross-origin-objects. The members are those of the interface of `$host`.
namespace CrossOrigin {

static JSValue behind(JSObject* object) { return object->getDirect(object->vm(), WebCore::builtinNames(object->vm()).hostPrivateName()); }
static JSValue childOf(JSObject* object, JSGlobalObject* realm, JSValue key) { return JSValue::decode(Bun__DOM__childOfForeignObject(realm, JSValue::encode(behind(object)), JSValue::encode(key))); }
static JSObject* membersOf(JSObject* object, JSGlobalObject* realm) { return asObject(JSValue::decode(Bun__DOM__membersOfForeignObject(realm, JSValue::encode(behind(object))))); }

static std::array<Identifier, 4> fallbacks(VM& vm)
{
    const auto& names = *vm.propertyNames;
    return { names.then, names.toStringTagSymbol, names.hasInstanceSymbol, names.isConcatSpreadableSymbol };
}

static bool refuse(JSGlobalObject* realm)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    throwException(realm, scope, WebCore::createDOMExceptionObject(realm, WebCore::ExceptionCode::SecurityError, "Blocked a frame from accessing a cross-origin frame."_s));
    return false;
}

static JSObject* bind(JSGlobalObject* realm, JSObject* object, JSValue function)
{
    if (!function.isCallable())
        return nullptr;
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue name = function.get(realm, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue length = function.get(realm, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* bound = JSBoundFunction::create(vm, realm, asObject(function), behind(object), ArgList(), length.asNumber(), asString(name), SourceTaintedOrigin::Untainted);
    RETURN_IF_EXCEPTION(scope, nullptr);
    bound->methodTable()->defineOwnProperty(bound, realm, vm.propertyNames->name, PropertyDescriptor(name, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum), true);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return bound;
}

// A function or a GetterSetter, of which each realm has its own.
static JSValue memberOf(JSObject* object, JSGlobalObject* realm, PropertyName name)
{
    if (name.isSymbol())
        return {};
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* byRealm = uncheckedDowncast<JSWeakMap>(object->getDirect(vm, WebCore::builtinNames(vm).dataPrivateName()));
    JSObject* known = byRealm->get(realm).getObject();
    if (!known)
        byRealm->set(vm, realm, known = constructEmptyObject(vm, realm->nullPrototypeObjectStructure()));
    if (JSValue found = known->getDirect(vm, name))
        return found;
    PropertyDescriptor member;
    bool isMember = membersOf(object, realm)->getOwnPropertyDescriptor(realm, name, member);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isMember)
        return {};
    if (member.isDataDescriptor()) {
        JSObject* function = bind(realm, object, member.value());
        RETURN_IF_EXCEPTION(scope, {});
        known->putDirect(vm, name, function);
        return function;
    }
    JSObject* getter = WTF::equal(name.uid(), "href"_s) ? nullptr : bind(realm, object, member.getter());
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* setter = bind(realm, object, member.setter());
    RETURN_IF_EXCEPTION(scope, {});
    auto* accessor = GetterSetter::create(vm, realm, getter, setter);
    known->putDirectAccessor(realm, name, accessor, PropertyAttribute::Accessor | 0);
    return accessor;
}

static bool isInquiry(PropertySlot& slot)
{
    slot.disableCaching();
    slot.setIsTaintedByOpaqueObject();
    return slot.isVMInquiry();
}

static bool getByIndex(JSObject* object, JSGlobalObject* realm, unsigned index, PropertySlot& slot)
{
    if (isInquiry(slot))
        return false;
    JSValue child = childOf(object, realm, jsNumber(index));
    if (!child.isObject())
        return refuse(realm);
    slot.setValue(object, PropertyAttribute::ReadOnly | 0, child);
    return true;
}

static bool get(JSObject* object, JSGlobalObject* realm, PropertyName name, PropertySlot& slot)
{
    if (auto index = parseIndex(name))
        return getByIndex(object, realm, *index, slot);
    if (isInquiry(slot))
        return false;
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue found = memberOf(object, realm, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (found && found.isGetterSetter()) {
        auto* accessor = uncheckedDowncast<GetterSetter>(found);
        if (accessor->isGetterNull() && slot.internalMethodType() == PropertySlot::InternalMethodType::Get)
            RELEASE_AND_RETURN(scope, refuse(realm));
        slot.setGetterSlot(object, PropertyAttribute::Accessor | PropertyAttribute::DontEnum, accessor);
        return true;
    }
    if (!found && !name.isSymbol())
        found = childOf(object, realm, jsString(vm, String(name.uid())));
    if (!found || !found.isObject()) {
        if (std::ranges::none_of(fallbacks(vm), [&](auto& it) { return name == it; }))
            RELEASE_AND_RETURN(scope, refuse(realm));
        found = jsUndefined();
    }
    slot.setValue(object, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum, found);
    return true;
}

static bool put(JSObject* object, JSGlobalObject* realm, PropertyName name, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSValue found = memberOf(object, realm, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (!found || !found.isGetterSetter() || uncheckedDowncast<GetterSetter>(found)->isSetterNull())
        RELEASE_AND_RETURN(scope, refuse(realm));
    RELEASE_AND_RETURN(scope, uncheckedDowncast<GetterSetter>(found)->callSetter(realm, jsUndefined(), value, true));
}

static void addNames(JSObject* object, JSGlobalObject* realm, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue length = childOf(object, realm, jsUndefined());
    for (unsigned index = 0; length.isNumber() && index < length.asNumber(); ++index)
        names.add(Identifier::from(vm, index));
    if (mode == DontEnumPropertiesMode::Exclude)
        return;
    JSObject* members = membersOf(object, realm);
    members->methodTable()->getOwnPropertyNames(members, realm, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, void());
    for (auto& name : fallbacks(vm))
        names.add(name);
}

static void finish(JSGlobalObject* realm, JSObject* object, JSValue behind)
{
    VM& vm = realm->vm();
    object->putDirect(vm, WebCore::builtinNames(vm).hostPrivateName(), behind);
    object->putDirect(vm, WebCore::builtinNames(vm).dataPrivateName(), JSWeakMap::create(vm, realm->weakMapStructure()));
}

template<typename Parent>
class Object : public Parent {
public:
    using Base = Parent;
    using Parent::Parent;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | OverridesGetOwnPropertyNames | OverridesPut | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | ProhibitsPropertyCaching | IsImmutablePrototypeExoticObject;

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* realm, PropertyName name, PropertySlot& slot) { return isOpen(object, name) ? Base::getOwnPropertySlot(object, realm, name, slot) : CrossOrigin::get(object, realm, name, slot); }
    static bool put(JSCell* cell, JSGlobalObject* realm, PropertyName name, JSValue value, PutPropertySlot& slot) { return isOpen(asObject(cell), name) ? Base::put(cell, realm, name, value, slot) : CrossOrigin::put(asObject(cell), realm, name, value); }
    static bool getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* realm, unsigned index, PropertySlot& slot) { return getByIndex(object, realm, index, slot); }
    static bool putByIndex(JSCell*, JSGlobalObject* realm, unsigned, JSValue, bool) { return refuse(realm); }
    static bool deleteProperty(JSCell*, JSGlobalObject* realm, PropertyName, DeletePropertySlot&) { return refuse(realm); }
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject* realm, unsigned) { return refuse(realm); }
    static void getOwnPropertyNames(JSObject* object, JSGlobalObject* realm, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode) { addNames(object, realm, names, mode); }
    static bool defineOwnProperty(JSObject*, JSGlobalObject* realm, PropertyName, const PropertyDescriptor&, bool) { return refuse(realm); }
    static bool preventExtensions(JSObject*, JSGlobalObject*) { return false; }

private:
    // A global object reads its own properties while it is being created.
    static bool isOpen(JSObject* object, PropertyName name) { return name.isPrivateName() || !behind(object); }
};

}

// The target of a `JSGlobalProxy` has to be a global object. No code runs in this one.
class RemoteWindow final : public CrossOrigin::Object<JSGlobalObject> {
public:
    using Base = CrossOrigin::Object<JSGlobalObject>;
    DECLARE_INFO;

    static RemoteWindow* create(VM& vm)
    {
        DeferGC deferGC(vm);
        auto* structure = Structure::create(vm, nullptr, jsNull(), TypeInfo(GlobalObjectType, StructureFlags), info());
        structure->setTransitionWatchpointIsLikelyToBeFired(true);
        auto* window = new (NotNull, allocateCell<RemoteWindow>(vm)) RemoteWindow(vm, structure);
        window->finishCreation(vm);
        window->setPrototypeDirect(vm, jsNull());
        return window;
    }

private:
    RemoteWindow(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};
static_assert(sizeof(RemoteWindow) == sizeof(JSGlobalObject));
const ClassInfo RemoteWindow::s_info = { "Object"_s, &JSGlobalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RemoteWindow) };

bool isRemoteWindow(JSGlobalObject* window) { return window->classInfo() == RemoteWindow::info(); }

// The window proxy, which is `existing` if that is one.
extern "C" EncodedJSValue Bun__DOM__createRemoteWindow(JSGlobalObject* realm, EncodedJSValue behind, EncodedJSValue existing)
{
    VM& vm = realm->vm();
    auto* window = RemoteWindow::create(vm);
    CrossOrigin::finish(realm, window, JSValue::decode(behind));
    auto* proxy = dynamicDowncast<JSGlobalProxy>(JSValue::decode(existing));
    if (proxy)
        proxy->setTarget(vm, window);
    else
        proxy = JSGlobalProxy::create(vm, JSGlobalProxy::createStructure(vm, window, jsNull()), window);
    window->addressOfGlobalThis()->set(vm, window, proxy);
    return JSValue::encode(proxy);
}

class PlainObject : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSNonFinalObject));
        return &vm.plainObjectSpace();
    }

    PlainObject(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename Class>
    static Class* create(JSGlobalObject* globalObject, JSValue prototype)
    {
        VM& vm = globalObject->vm();
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, Class::StructureFlags), Class::info());
        auto* object = new (NotNull, allocateCell<Class>(vm)) Class(vm, structure);
        object->finishCreation(vm);
        return object;
    }
};

class RemoteLocation final : public CrossOrigin::Object<PlainObject> {
public:
    using Base = CrossOrigin::Object<PlainObject>;
    using Base::Base;
    DECLARE_INFO;
};
const ClassInfo RemoteLocation::s_info = { "Object"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RemoteLocation) };

bool isRemoteLocation(JSObject* object) { return object->classInfo() == RemoteLocation::info(); }

extern "C" EncodedJSValue Bun__DOM__createRemoteLocation(JSGlobalObject* realm, EncodedJSValue behind)
{
    auto* location = PlainObject::create<RemoteLocation>(realm, jsNull());
    CrossOrigin::finish(realm, location, JSValue::decode(behind));
    return JSValue::encode(location);
}

// Null instead of undefined if the name can appear unannounced.
extern "C" EncodedJSValue Bun__DOM__namedInWindow(JSGlobalObject*, EncodedJSValue window, StringImpl* name);

extern "C" void Bun__DOM__announceNameInWindow([[maybe_unused]] JSGlobalObject* globalObject, [[maybe_unused]] AtomStringImpl* nameOrNull)
{
#if ENABLE(AOT)
    AOT::didAnnounceNameAboveGlobalObject(globalObject->vm(), nameOrNull);
#endif
}

extern "C" bool Bun__DOM__hearsOfNamesInWindow([[maybe_unused]] JSGlobalObject* globalObject)
{
#if ENABLE(AOT)
    return !globalObject->vm().aotState().hashesOfNamesTakenAsUnannounced.isEmpty();
#else
    return false;
#endif
}

// https://webidl.spec.whatwg.org/#named-properties-object
class WindowProperties final : public PlainObject {
public:
    using Base = PlainObject;
    using Base::Base;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | GetOwnPropertySlotIsImpureForPropertyAbsence | NewImpurePropertyFiresWatchpoints | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | IsImmutablePrototypeExoticObject;
    DECLARE_INFO;

    static bool getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
    {
        return getOwnPropertySlot(object, globalObject, Identifier::from(globalObject->vm(), index), slot);
    }

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (name.isSymbol())
            RELEASE_AND_RETURN(scope, Base::getOwnPropertySlot(object, globalObject, name, slot));
        bool isHidden = asObject(object->getPrototypeDirect())->hasProperty(globalObject, name);
        RETURN_IF_EXCEPTION(scope, false);
        if (isHidden)
            return false;
        slot.disableCaching();
        if (slot.isVMInquiry()) {
            slot.setIsTaintedByOpaqueObject();
            return false;
        }
        JSGlobalObject* realm = object->structure()->realm();
        JSGlobalObject* world = IsolatedWorld::is(realm) ? std::exchange(realm, IsolatedWorld::pageOf(realm)) : nullptr;
        JSObject* target = world && slot.thisValue().isObject() ? IsolatedWorld::targetOf(asObject(slot.thisValue())) : nullptr;
        JSObject* window = Bindgen::existingReceiverOf(realm, target ? target : slot.thisValue());
        if (!window)
            window = Bindgen::existingReceiverOf(realm, jsUndefined());
        JSValue found = window ? JSValue::decode(Bun__DOM__namedInWindow(realm, JSValue::encode(window), name.uid())) : jsNull();
        RETURN_IF_EXCEPTION(scope, false);
        if (found.isNull())
            slot.setIsTaintedByOpaqueObject();
        if (found.isUndefinedOrNull())
            return false;
        if (world)
            found = IsolatedWorld::toWorld(world, found);
        RETURN_IF_EXCEPTION(scope, false);
        slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum), found);
        return true;
    }
    static bool defineOwnProperty(JSObject*, JSGlobalObject* globalObject, PropertyName, const PropertyDescriptor&, bool shouldThrow)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        return typeError(globalObject, scope, shouldThrow, "Defining a property on a WindowProperties object is not allowed."_s);
    }
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&) { return false; }
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned) { return false; }
    static bool preventExtensions(JSObject*, JSGlobalObject*) { return false; }
};
const ClassInfo WindowProperties::s_info = { "WindowProperties"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(WindowProperties) };

JSObject* createWindowProperties(JSGlobalObject* globalObject, JSValue prototype)
{
    VM& vm = globalObject->vm();
    auto* properties = PlainObject::create<WindowProperties>(globalObject, prototype);
    properties->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "WindowProperties"_s), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    properties->didBecomePrototype(vm);
    return properties;
}

static JSGlobalObject* realmOfScript(StackVisitor& visitor)
{
#if ENABLE(AOT)
    if (visitor->isCompiledFrame())
        return AOT::FunctionDescription(visitor->compiledFrame().function).isOfProgram() ? visitor->compiledFrame().globalObject() : nullptr;
#endif
    CodeBlock* codeBlock = visitor->codeBlock();
    return codeBlock && !codeBlock->unlinkedCodeBlock()->isBuiltinFunction() ? codeBlock->globalObject() : nullptr;
}

extern "C" bool Bun__WebRealm__areOfSameOrigin(JSGlobalObject*, JSGlobalObject*);

// The global object of the innermost script on the stack, or of the outermost one. A script of another origin than `callee`
// has only caused an event, and the listener is a native function.
static JSGlobalObject* callingWindow(JSGlobalObject* callee, CallFrame* callFrame, bool isEntry)
{
    VM& vm = callee->vm();
    JSGlobalObject* found = nullptr;
    EntryFrame* entryFrame = nullptr;
    StackVisitor::visit(callFrame, vm, [&](StackVisitor& visitor) {
        JSGlobalObject* realm = realmOfScript(visitor);
        if (!realm)
            return IterationStatus::Continue;
        if (found && visitor->entryFrame() != entryFrame)
            return IterationStatus::Done;
        if (IsolatedWorld::is(realm) || Bindgen::existingReceiverOf(realm, jsUndefined())) {
            if (!Bun__WebRealm__areOfSameOrigin(realm, callee))
                return IterationStatus::Done;
            found = realm;
            entryFrame = visitor->entryFrame();
        }
        return isEntry || !found ? IterationStatus::Continue : IterationStatus::Done;
    });
    return found;
}

extern "C" EncodedJSValue Bun__DOM__callingWindow(JSGlobalObject* globalObject, bool isEntry)
{
    auto* found = callingWindow(globalObject, globalObject->vm().topCallFrame, isEntry);
    if (JSGlobalObject* page = found ? IsolatedWorld::pageOf(found) : nullptr)
        found = page;
    return JSValue::encode(found ? found : jsNull());
}

extern "C" void Bun__DOM__replaceOpener(JSGlobalObject* globalObject, EncodedJSValue window, EncodedJSValue value)
{
    JSObject* object = asObject(JSValue::decode(window));
    object->methodTable()->defineOwnProperty(object, globalObject, Identifier::fromString(globalObject->vm(), "opener"_s), PropertyDescriptor(JSValue::decode(value), 0), true);
}

// https://html.spec.whatwg.org/#the-location-interface
extern "C" void Bun__DOM__finishLocation(JSGlobalObject* realm, EncodedJSValue location)
{
    VM& vm = realm->vm();
    constexpr unsigned attributes = PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete;
    asObject(JSValue::decode(location))->putDirect(vm, vm.propertyNames->valueOf, realm->objectProtoValueOfFunction(), attributes);
    asObject(JSValue::decode(location))->putDirect(vm, vm.propertyNames->toPrimitiveSymbol, jsUndefined(), attributes);
}

} // namespace Bun
