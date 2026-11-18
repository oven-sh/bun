#include "root.h"

#include "IsolatedWorld.h"

#include "AbortSignal.h"
#include "Bindgen/InterfaceLookup.h"
#include "Bindgen/JSGlobalStandIn.h"
#include "Bindgen/JSInterface.h"
#include "BunClientData.h"
#include "DesktopRealm.h"
#include "DesktopWindow.h"
#include "GeneratedBlob.h"
#include "JSAbortSignal.h"
#include "JSCryptoKey.h"
#include "JSDOMException.h"
#include "JSDOMURL.h"
#include "JSDOMFormData.h"
#include "JSURLSearchParams.h"
#include "SerializedScriptValue.h"
#include "WebGlobalObject.h"
#include "blob.h"
#include "streams/JSReadableStream.h"
#include "streams/JSWritableStream.h"

#include <JavaScriptCore/AOTCompiledCallee.h>
#include <JavaScriptCore/ArrayIteratorPrototype.h>
#include <JavaScriptCore/AsyncGeneratorPrototype.h>
#include <JavaScriptCore/AsyncIteratorPrototype.h>
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/DOMAttributeGetterSetter.h>
#include <JavaScriptCore/GeneratorPrototype.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSCellButterfly.h>
#include <JavaScriptCore/JSCustomGetterFunction.h>
#include <JavaScriptCore/JSCustomSetterFunction.h>
#include <JavaScriptCore/JSDataView.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/WeakMapImplInlines.h>

namespace Bun::IsolatedWorld {

using namespace JSC;

static const Identifier& recordName(VM& vm) { return WebCore::builtinNames(vm).storagePrivateName(); }
static const Identifier& structureName(VM& vm) { return WebCore::builtinNames(vm).typePrivateName(); }
static const Identifier& handlersName(VM& vm) { return WebCore::builtinNames(vm).handleEventPrivateName(); }
static const Identifier& thrownName(VM& vm) { return WebCore::builtinNames(vm).attributesPrivateName(); }
static const Identifier& unforgeablesName(VM& vm) { return WebCore::builtinNames(vm).attributesPrivateName(); }

static JSCellButterfly* createRecord(VM& vm, std::initializer_list<JSValue> values)
{
    auto* record = JSCellButterfly::create(vm, CopyOnWriteArrayWithContiguous, values.size());
    unsigned index = 0;
    for (JSValue value : values)
        record->setIndex(vm, index++, value ? value : jsUndefined());
    return record;
}

static JSCellButterfly* recordOf(VM& vm, JSObject* object)
{
    JSValue record = object->getDirect(vm, recordName(vm));
    return record ? dynamicDowncast<JSCellButterfly>(record) : nullptr;
}

// The slot of a property as it is: an accessor is not called. Not for proxies.
static JSValue ownMember(JSObject* object, PropertyName name, unsigned& attributes)
{
    if (!object->realmMayBeNull())
        return {};
    VM& vm = object->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
    bool found = object->methodTable()->getOwnPropertySlot(object, object->realm(), name, slot);
    if (scope.exception() || !found) {
        scope.clearExceptionExceptTermination();
        return {};
    }
    attributes = slot.attributes();
    if (slot.isAccessor())
        return slot.getterSetter();
    return slot.isCustom() ? object->getDirect(vm, name) : slot.getValue(object->realm(), name);
}

static JSValue ownValue(JSObject* object, PropertyName name)
{
    unsigned attributes = 0;
    JSValue value = ownMember(object, name, attributes);
    return value && !(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue) ? value : jsUndefined();
}

static bool isOfBuiltinModule(JSValue value)
{
#if ENABLE(AOT)
    if (value.isCell() && isCompiledCalleeType(value.asCell()->type()))
        return AOT::belongsToBuiltinModule(value.asCell());
#endif
    auto* function = dynamicDowncast<JSFunction>(value);
    return function && function->isBuiltinFunction();
}

static bool isNativeFunction(JSValue value)
{
    return value.isCell() && value.asCell()->classInfo() == JSFunction::info() && uncheckedDowncast<JSFunction>(value)->isHostFunction();
}

// Whether no script has written it.
static bool isOfPlatform(VM& vm, PropertyName name, JSValue member, unsigned attributes)
{
    if (auto* accessor = dynamicDowncast<GetterSetter>(member))
        return (accessor->isGetterNull() || isOfBuiltinModule(accessor->getter()) || accessor->getter()->inherits<JSCustomGetterFunction>() || isNativeFunction(accessor->getter())) && (accessor->isSetterNull() || isOfBuiltinModule(accessor->setter()) || accessor->setter()->inherits<JSCustomSetterFunction>() || isNativeFunction(accessor->setter()));
    if (attributes & PropertyAttribute::CustomAccessorOrValue)
        return attributes & PropertyAttribute::CustomAccessor;
    if (member.isCallable())
        return isOfBuiltinModule(member) || isNativeFunction(member) || member.inherits<InternalFunction>();
    if (name == vm.propertyNames->toStringTagSymbol || name == vm.propertyNames->unscopablesSymbol)
        return true;
    return !member.isObject() && attributes & PropertyAttribute::ReadOnly && attributes & PropertyAttribute::DontDelete;
}

static void putAsItIs(JSGlobalObject* globalObject, JSObject* to, PropertyName name, JSValue value, unsigned attributes)
{
    if (attributes & PropertyAttribute::Accessor)
        to->putDirectAccessor(globalObject, name, uncheckedDowncast<GetterSetter>(value), attributes);
    else if (attributes & PropertyAttribute::CustomAccessorOrValue)
        to->putDirectCustomAccessor(globalObject->vm(), name, value, attributes);
    else
        to->putDirect(globalObject->vm(), name, value, attributes);
}

static void forEachMember(JSObject* object, NOESCAPE const auto& callback)
{
    VM& vm = object->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, object->realm(), names, DontEnumPropertiesMode::Include);
    if (scope.exception())
        return void(scope.clearExceptionExceptTermination());
    for (auto& name : names) {
        unsigned attributes = 0;
        if (JSValue member = parseIndex(name) ? JSValue() : ownMember(object, name, attributes))
            callback(name, member, attributes);
    }
}

static JSObject* createHolder(JSGlobalObject* realm)
{
    auto* holder = constructEmptyObject(realm->vm(), realm->nullPrototypeObjectStructure());
    holder->convertToDictionary(realm->vm());
    return holder;
}

class PlainCell : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSNonFinalObject));
        return &vm.plainObjectSpace();
    }

    PlainCell(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename Class>
    static Class* create(VM& vm, Structure* structure, JSValue held)
    {
        auto* object = new (NotNull, allocateCell<Class>(vm)) Class(vm, structure);
        object->finishCreation(vm);
        object->putDirect(vm, recordName(vm), held);
        return object;
    }

    template<typename Class>
    static Structure* createStructure(JSGlobalObject* globalObject, JSValue prototype, unsigned moreFlags = 0)
    {
        return Structure::create(globalObject->vm(), globalObject, prototype, TypeInfo(ObjectType, Class::StructureFlags | moreFlags), Class::info(), Class::indexingType);
    }

    static constexpr IndexingType indexingType = NonArray;
};

// Stands for a platform object of the page.
class Alias : public PlainCell {
public:
    using Base = PlainCell;
    using Base::Base;
    DECLARE_INFO;

    JSObject* target() { return asObject(getDirect(firstOutOfLineOffset)); }
};
const ClassInfo Alias::s_info = { "Object"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Alias) };

// For one with indexed or named properties.
class ExoticAlias final : public Alias {
public:
    using Base = Alias;
    using Base::Base;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | OverridesGetOwnPropertyNames | OverridesPut | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | GetOwnPropertySlotIsImpure | GetOwnPropertySlotIsImpureForPropertyAbsence | ProhibitsPropertyCaching;
    static constexpr IndexingType indexingType = MayHaveIndexedAccessors;
    DECLARE_INFO;
    DECLARE_LEGACY_PLATFORM_OBJECT;
    PUT_METHOD(DECLARE_SPECIAL_METHOD)

private:
    bool isOrdinary(JSGlobalObject*, PropertyName);
    bool takesNames();
    bool storesUnder(PropertyName);
    bool isArray();
    JSObject* window();
};
const ClassInfo ExoticAlias::s_info = { "Object"_s, &Alias::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ExoticAlias) };

// Gets the members of what is in its record when they are looked up. Scripts of the page can change the last one.
class Members final : public PlainCell {
public:
    using Base = PlainCell;
    using Base::Base;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | OverridesGetOwnSpecialPropertyNames | OverridesPut | GetOwnPropertySlotIsImpureForPropertyAbsence;
    DECLARE_INFO;

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        if (slot.isVMInquiry())
            slot.setIsTaintedByOpaqueObject();
        else
            uncheckedDowncast<Members>(object)->reify(name);
        return Base::getOwnPropertySlot(object, globalObject, name, slot);
    }
    static bool put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
    {
        uncheckedDowncast<Members>(cell)->reify(name);
        return Base::put(cell, globalObject, name, value, slot);
    }
    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow)
    {
        uncheckedDowncast<Members>(object)->reify(name);
        return Base::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow);
    }
    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot)
    {
        uncheckedDowncast<Members>(cell)->reifyAll();
        return Base::deleteProperty(cell, globalObject, name, slot);
    }
    static void getOwnSpecialPropertyNames(JSObject* object, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode)
    {
        uncheckedDowncast<Members>(object)->reifyAll();
    }
    static bool preventExtensions(JSObject* object, JSGlobalObject* globalObject)
    {
        uncheckedDowncast<Members>(object)->reifyAll();
        return Base::preventExtensions(object, globalObject);
    }

private:
    void reify(PropertyName);
    void reifyAll();
};
const ClassInfo Members::s_info = { "Object"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Members) };

static JSC_DECLARE_HOST_FUNCTION(callInPage);
static JSC_DECLARE_HOST_FUNCTION(getHandler);
static JSC_DECLARE_HOST_FUNCTION(setHandler);
static JSC_DECLARE_HOST_FUNCTION(runHandler);
static JSC_DECLARE_HOST_FUNCTION(getInWorld);
static JSC_DECLARE_HOST_FUNCTION(runBehindBarrier);
static JSC_DECLARE_HOST_FUNCTION(callEndOfStream);
static JSC_DECLARE_HOST_FUNCTION(constructInPage);
static JSC_DECLARE_HOST_FUNCTION(getInPage);
static JSC_DECLARE_HOST_FUNCTION(setInPage);
static JSC_DECLARE_HOST_FUNCTION(callInWorld);
static JSC_DECLARE_HOST_FUNCTION(callMethodInWorld);

class Constructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    DECLARE_INFO;

    static Constructor* create(JSGlobalObject* globalObject, JSValue base, unsigned length, const String& name)
    {
        VM& vm = globalObject->vm();
        asObject(base)->didBecomePrototype(vm);
        auto* structure = Structure::create(vm, globalObject, base, TypeInfo(InternalFunctionType, StructureFlags), info());
        auto* constructor = new (NotNull, allocateCell<Constructor>(vm)) Constructor(vm, structure);
        constructor->finishCreation(vm, length, name, PropertyAdditionMode::WithoutStructureTransition);
        return constructor;
    }

private:
    Constructor(VM& vm, Structure* structure)
        : Base(vm, structure, callInPage, constructInPage)
    {
    }
};
const ClassInfo Constructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Constructor) };

static bool isInterfaceCell(JSObject* object)
{
    return object->type() == Bindgen::JSInterfaceObject<0>::cellType || object->type() == Bindgen::JSInterfaceObject<2>::cellType;
}

static JSGlobalObject* asGlobalObject(JSObject* object)
{
    if (auto* proxy = dynamicDowncast<JSGlobalProxy>(object))
        return proxy->target();
    return dynamicDowncast<JSGlobalObject>(object);
}

// What has the static tables of a window.
static JSObject* asWindow(JSObject* object)
{
    if (object->inherits<Bindgen::JSGlobalStandIn>())
        return object;
    return dynamicDowncast<WebGlobalObject>(asGlobalObject(object));
}

static bool isCrossOrigin(JSObject* object)
{
    if (auto* global = asGlobalObject(object))
        return !global->inherits<Zig::GlobalObject>();
    return isRemoteLocation(object);
}

// The members of the dictionaries of events through which scripts hand values to each other.
static bool holdsAnyValue(PropertyName name)
{
    return std::ranges::any_of(std::array { "data"_s, "detail"_s, "error"_s, "newValue"_s, "promise"_s, "reason"_s, "state"_s }, [&](ASCIILiteral it) { return WTF::equal(name.uid(), it); });
}

static thread_local const ScopedLambda<JSValue()>* whatRunsBehindBarrier;

class World {
public:
    explicit World(JSGlobalObject* global)
        : m_vm(global->vm())
        , m_global(global)
        , m_record(recordOf(m_vm, global))
    {
    }

    static void create(JSGlobalObject* global, JSGlobalObject* page)
    {
        VM& vm = global->vm();
        auto map = [&] { return JSWeakMap::create(vm, global->weakMapStructure()); };
        global->putDirect(vm, recordName(vm), createRecord(vm, { page, map(), map(), map(), createHolder(global), JSFunction::create(vm, page, 0, emptyString(), runBehindBarrier, ImplementationVisibility::Public) }));
    }

    VM& vm() const { return m_vm; }
    JSGlobalObject* global() const { return m_global; }
    JSGlobalObject* page() const { return uncheckedDowncast<JSGlobalObject>(m_record->get(0)); }
    // By the objects of the page.
    JSWeakMap* inWorld() const { return uncheckedDowncast<JSWeakMap>(m_record->get(1)); }
    // By the objects of the world.
    JSWeakMap* inPage() const { return uncheckedDowncast<JSWeakMap>(m_record->get(2)); }
    JSWeakMap* prototypes() const { return uncheckedDowncast<JSWeakMap>(m_record->get(3)); }

    JSObject* deletedGlobals() const { return asObject(m_record->get(4)); }

    // A script of the page that `run` gets to has no function of the world as its `caller`.
    JSValue behindBarrier(NOESCAPE const auto& run)
    {
        ScopedLambda<JSValue()> lambda(run);
        SetForScope<const ScopedLambda<JSValue()>*> whatRuns(whatRunsBehindBarrier, &lambda, nullptr);
        JSValue barrier = m_record->get(5);
        return call(page(), barrier, getCallData(barrier), jsUndefined(), ArgList());
    }

    void pair(JSObject* ofWorld, JSObject* ofPage)
    {
        inWorld()->set(m_vm, ofPage, ofWorld);
        inPage()->set(m_vm, ofWorld, ofPage);
    }

    // It has to be public: `Function.prototype.caller` looks past the others.
    JSFunction* createFunction(JSGlobalObject* realm, unsigned length, const String& name, NativeFunction call, std::initializer_list<JSValue> record)
    {
        auto* function = JSFunction::create(m_vm, realm, length, name, call, ImplementationVisibility::Public);
        function->putDirect(m_vm, recordName(m_vm), createRecord(m_vm, record));
        return function;
    }

    JSObject* functionFor(JSObject* function, const String& givenName = {}, bool keepsResult = false)
    {
        JSValue lengthValue = ownValue(function, m_vm.propertyNames->length);
        unsigned length = lengthValue.isUInt32() ? lengthValue.asUInt32() : 0;
        String name = givenName;
        if (JSValue value = name.isNull() ? ownValue(function, m_vm.propertyNames->name) : jsUndefined(); value.isString())
            name = asString(value)->tryGetValue();
        if (function->realm() == m_global && isNativeFunction(function))
            function = JSFunction::create(m_vm, page(), length, name, uncheckedDowncast<JSFunction>(function)->nativeFunction().retagged<CFunctionPtrTag>(), ImplementationVisibility::Public);
        return createFunction(m_global, length, name, callInPage, { function, jsBoolean(keepsResult), jsBoolean(name == "initCustomEvent"_s || name == "initMessageEvent"_s) });
    }

    // What legacy platform objects have of `Array.prototype`.
    JSValue arrayFunctionLike(JSObject* function)
    {
        auto& names = m_vm.propertyNames->builtinNames();
        auto* realm = function->realm();
        if (function == realm->arrayProtoValuesFunction())
            return m_global->arrayProtoValuesFunction();
        for (auto& name : { names.entriesPrivateName(), names.forEachPrivateName(), names.keysPrivateName(), names.valuesPrivateName() }) {
            if (function == realm->arrayPrototype()->getDirect(m_vm, name))
                return m_global->arrayPrototype()->getDirect(m_vm, name);
        }
        return {};
    }

    std::pair<JSValue, unsigned> memberFor(PropertyName, JSValue, unsigned attributes, bool isOfBody = false);

    void putStatics(JSObject* from, JSObject* to)
    {
        forEachMember(from, [&](const Identifier& name, JSValue value, unsigned attributes) {
            auto& names = *m_vm.propertyNames;
            if (name == names.length || name == names.name || name == names.prototype || to->getDirect(m_vm, name) || !isOfPlatform(m_vm, name, value, attributes))
                return;
            auto [member, memberAttributes] = memberFor(name, value, attributes);
            putAsItIs(m_global, to, name, member, memberAttributes);
        });
    }

    JSObject* createMembers(JSObject* key, JSValue base, std::initializer_list<JSValue> sources)
    {
        if (base.isObject())
            asObject(base)->didBecomePrototype(m_vm);
        Structure* structure = PlainCell::createStructure<Members>(m_global, base);
        structure->setMayBePrototype(true);
        auto* members = PlainCell::create<Members>(m_vm, structure, createRecord(m_vm, sources));
        prototypes()->set(m_vm, key, members);
        return members;
    }

    JSObject* prototypeOfInterface(unsigned number)
    {
        JSObject* hidden = Bindgen::prototypeForInterface(m_global, number);
        if (JSObject* known = prototypes()->get(hidden).getObject())
            return known;
        JSValue base = hidden->getPrototypeDirect();
        bool hasNamedProperties = asObject(base)->classInfo()->className == "WindowProperties"_s;
        if (hasNamedProperties)
            base = asObject(base)->getPrototypeDirect();
        if (auto baseNumber = Bindgen::interfaceWithPrototype(m_global, asObject(base)))
            base = prototypeOfInterface(*baseNumber);
        else if (asObject(base)->getDirect(m_vm, m_vm.propertyNames->toStringTagSymbol) && base != m_global->iteratorPrototype() && base != m_global->asyncIteratorPrototype())
            base = prototypeShadowing(asObject(base));
        if (hasNamedProperties)
            base = createWindowProperties(m_global, base);
        return createMembers(hidden, base, { hidden, JSValue() });
    }

    JSObject* constructorOfInterface(unsigned number)
    {
        JSObject* ofPage = Bindgen::constructorForInterface(page(), number);
        JSObject* hidden = Bindgen::constructorForInterface(m_global, number);
        if (JSObject* known = inWorld()->get(ofPage).getObject())
            return known;
        if (!hidden->isCallable()) {
            JSObject* members = createMembers(hidden, m_global->objectPrototype(), { hidden, JSValue() });
            pair(members, ofPage);
            return members;
        }
        bool hasPrototype = ownValue(hidden, m_vm.propertyNames->prototype).isObject();
        JSObject* constructor = createConstructor(ofPage, hasPrototype ? prototypeOfInterface(number) : nullptr);
        putStatics(hidden, constructor);
        return constructor;
    }

    JSObject* createConstructor(JSObject* ofPage, JSObject* prototype)
    {
        JSObject* base = prototype ? prototype->getPrototypeDirect().getObject() : nullptr;
        JSValue baseConstructor = base && base != m_global->objectPrototype() && base != m_global->errorPrototype() ? ownValue(base, m_vm.propertyNames->constructor) : jsUndefined();
        JSValue length = ownValue(ofPage, m_vm.propertyNames->length);
        JSValue name = ownValue(ofPage, m_vm.propertyNames->name);
        JSObject* constructor = Constructor::create(m_global, baseConstructor.isCallable() ? baseConstructor : m_global->functionPrototype(), length.isUInt32() ? length.asUInt32() : 0, name.isString() ? String(asString(name)->tryGetValue()) : emptyString());
        constructor->putDirect(m_vm, recordName(m_vm), createRecord(m_vm, { ofPage, jsUndefined(), jsUndefined() }));
        pair(constructor, ofPage);
        if (prototype)
            constructor->putDirect(m_vm, m_vm.propertyNames->prototype, prototype, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
        return constructor;
    }

    // Null if `function` is none.
    JSObject* interfaceObjectFor(JSObject* function)
    {
        auto number = Bindgen::interfaceWithConstructor(function->realm(), function);
        return number ? constructorOfInterface(*number) : nullptr;
    }

    // Of a class of Bun's.
    JSObject* nativeConstructor(JSGlobalObject* realm, const String& name)
    {
        auto* global = dynamicDowncast<Zig::GlobalObject>(realm);
        JSObject* natives = global && global->natives() ? global->natives() : realm;
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
        JSValue constructor = natives->get(realm, Identifier::fromString(m_vm, name));
        scope.clearExceptionExceptTermination();
        return constructor && constructor.isCallable() && constructor.asCell()->type() != ProxyObjectType ? asObject(constructor) : nullptr;
    }

    JSObject* nativePrototype(JSGlobalObject* realm, const String& name)
    {
        JSObject* constructor = nativeConstructor(realm, name);
        return constructor ? ownValue(constructor, m_vm.propertyNames->prototype).getObject() : nullptr;
    }

    // It inherits from the one whose members it shadows, for `instanceof`.
    JSObject* prototypeShadowing(JSObject* own)
    {
        if (JSObject* known = prototypes()->get(own).getObject())
            return known;
        JSObject* base = own->getPrototypeDirect().getObject();
        bool isRoot = !base || base == m_global->objectPrototype() || base == m_global->iteratorPrototype() || base == m_global->asyncIteratorPrototype() || base->inherits<Members>();
        return createMembers(own, own, { own, isRoot ? JSValue() : base, JSValue() });
    }

    // Null for what a script has made.
    JSObject* prototypeFor(JSObject* prototype)
    {
        auto* realm = prototype->realm();
        if (auto number = Bindgen::interfaceWithPrototype(realm, prototype))
            return prototypeOfInterface(*number);
        if (JSObject* known = prototypes()->get(prototype).getObject())
            return known;
        if (prototype == realm->mapPrototype())
            return prototypeShadowing(m_global->mapPrototype());
        if (prototype == realm->jsSetPrototype())
            return prototypeShadowing(m_global->jsSetPrototype());
        JSValue tag = prototype->getDirect(m_vm, m_vm.propertyNames->toStringTagSymbol);
        String name = tag && tag.isString() ? String(asString(tag)->tryGetValue()) : String();
        if (name.isEmpty() || nativePrototype(realm, name) != prototype)
            return nullptr;
        JSObject* own = nativePrototype(m_global, name);
        return own ? prototypeShadowing(own) : nullptr;
    }

    // For a native class that has no name on the global object.
    JSObject* prototypeLike(JSObject* prototype)
    {
        if (prototype->type() != ObjectType || !prototype->structure()->realm())
            return m_global->objectPrototype();
        if (JSObject* known = prototypes()->get(prototype).getObject())
            return known;
        return prototype == prototype->realm()->objectPrototype() ? m_global->objectPrototype() : createMembers(prototype, baseFor(prototype->getPrototypeDirect()), { prototype });
    }

    JSValue baseFor(JSValue base)
    {
        JSObject* object = base.getObject();
        if (!object)
            return base;
        auto* realm = object->realmMayBeNull();
        if (!realm || !m_vm.isSafeToRecurse())
            return m_global->objectPrototype();
        if (object == realm->objectPrototype())
            return m_global->objectPrototype();
        if (object == realm->errorPrototype())
            return m_global->errorPrototype();
        if (object == realm->arrayPrototype())
            return m_global->arrayPrototype();
        if (object == realm->iteratorPrototype())
            return m_global->iteratorPrototype();
        if (object == realm->asyncIteratorPrototype())
            return m_global->asyncIteratorPrototype();
        JSObject* own = prototypeFor(object);
        return own ? own : baseFor(object->getPrototypeDirect());
    }

    JSObject* createAlias(JSObject* target, JSObject* prototype, bool isExotic)
    {
        bool remembersStructure = prototype && prototype->inherits<Members>();
        JSValue known = remembersStructure ? prototype->getDirect(m_vm, structureName(m_vm)) : JSValue();
        auto* structure = known ? uncheckedDowncast<Structure>(known) : nullptr;
        if (!structure || (structure->classInfoForCells() == ExoticAlias::info()) != isExotic) {
            if (prototype)
                prototype->didBecomePrototype(m_vm);
            JSValue value = prototype ? JSValue(prototype) : jsNull();
            bool isUndetectable = target->structure()->typeInfo().masqueradesAsUndefined();
            if (isUndetectable)
                m_global->masqueradesAsUndefinedWatchpointSet().fireAll(m_vm, "Allocated an undetectable object");
            structure = isExotic ? PlainCell::createStructure<ExoticAlias>(m_global, value, isUndetectable ? MasqueradesAsUndefined : 0) : PlainCell::createStructure<Alias>(m_global, value);
            if (remembersStructure) {
                prototype->putDirect(m_vm, structureName(m_vm), structure);
                rememberUnforgeables(target, prototype);
            }
        }
        Alias* alias = isExotic ? PlainCell::create<ExoticAlias>(m_vm, structure, target) : PlainCell::create<Alias>(m_vm, structure, target);
        inWorld()->set(m_vm, target, alias);
        if (JSValue unforgeables = remembersStructure ? prototype->getDirect(m_vm, unforgeablesName(m_vm)) : JSValue())
            forEachMember(asObject(unforgeables), [&](const Identifier& name, JSValue member, unsigned attributes) { putAsItIs(m_global, alias, name, member, attributes); });
        return alias;
    }

    void rememberUnforgeables(JSObject* target, JSObject* prototype)
    {
        if (!isInterfaceCell(target))
            return;
        Vector<std::pair<Identifier, unsigned>, 2> names;
        // What it has after `valueOf` is from scripts.
        bool isLocation = target->classInfo()->className == "Location"_s;
        target->structure()->forEachProperty(m_vm, [&](const PropertyTableEntry& entry) {
            if (isLocation && entry.key() == m_vm.propertyNames->valueOf.impl())
                return false;
            if ((isLocation || entry.attributes() & PropertyAttribute::CustomAccessor) && !PropertyName(entry.key()).isPrivateName())
                names.append({ Identifier::fromUid(m_vm, entry.key()), entry.attributes() });
            return true;
        });
        if (names.isEmpty())
            return;
        JSObject* holder = createHolder(m_global);
        for (auto& [name, attributes] : names) {
            auto [member, memberAttributes] = memberFor(name, target->getDirect(m_vm, name), attributes);
            putAsItIs(m_global, holder, name, member, memberAttributes);
        }
        prototype->putDirect(m_vm, unforgeablesName(m_vm), holder);
    }

    // What `window` has under the name of a row of its static tables.
    std::pair<JSValue, unsigned> memberOfWindow(JSObject* window, PropertyName, const HashTableValue&);
    JSValue adopt(JSValue);

private:
    VM& m_vm;
    JSGlobalObject* m_global;
    JSCellButterfly* m_record;
};

enum class To : bool { World,
    Page };

class Crossing {
public:
    Crossing(World world, To to)
        : m_world(world)
        , m_vm(world.vm())
        , m_to(to)
        , m_realm(to == To::World ? world.global() : world.page())
    {
    }

    JSValue convert(JSValue value)
    {
        if (!value.isObject())
            return value;
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSObject* object = asObject(value);
        if (m_isData && object->isCallable())
            return remember(object, constructEmptyObject(m_realm));
        if (JSObject* known = counterpartOf(object))
            return known;
        if (auto seen = m_seen.find(object); seen != m_seen.end())
            return seen->value;
        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_realm, scope);
            return {};
        }
        if (!object->structure()->realm() && object->type() != GlobalObjectType)
            return jsNull();
        RELEASE_AND_RETURN(scope, m_to == To::World ? toWorld(object) : toPage(object));
    }

    // Nothing in it can be called.
    JSValue convertData(JSValue value)
    {
        SetForScope isData(m_isData, true);
        return convert(value);
    }

    JSValue convertReceiver(JSValue value)
    {
        JSObject* object = value.getObject();
        if (m_to == To::World || !object || object->type() == JSDOMWrapperType || object->inherits<WebCore::JSEventTarget>())
            return convert(value);
        JSObject* known = counterpartOf(object);
        return known ? known : constructEmptyObject(m_realm);
    }

    void convertArguments(CallFrame* callFrame, MarkedArgumentBuffer& arguments, bool areData = false)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        SetForScope isData(m_isData, areData);
        for (unsigned i = 0; i < callFrame->argumentCount(); ++i) {
            JSValue argument = convert(callFrame->uncheckedArgument(i));
            RETURN_IF_EXCEPTION(scope, );
            arguments.append(argument);
        }
        if (arguments.hasOverflowed()) [[unlikely]]
            throwOutOfMemoryError(m_realm, scope);
    }

    void convertArgumentsOfConstructor(CallFrame* callFrame, MarkedArgumentBuffer& arguments)
    {
        m_isForConstructor = true;
        convertArguments(callFrame, arguments);
    }

    // What `run` returns, or throws.
    EncodedJSValue convertOutcome(NOESCAPE const auto& run)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSValue result = run();
        if (auto* exception = scope.exception()) [[unlikely]] {
            if (!scope.tryClearException())
                return {};
            JSValue error = convert(exception->value());
            RETURN_IF_EXCEPTION(scope, {});
            return throwVMError(m_realm, scope, error);
        }
        if (auto* kept = dynamicDowncast<JSCellButterfly>(result))
            return JSValue::encode(kept->get(1));
        RELEASE_AND_RETURN(scope, JSValue::encode(convert(result)));
    }

    JSObject* counterpartOf(JSObject* object)
    {
        if (m_to == To::Page) {
            if (auto* alias = dynamicDowncast<Alias>(object))
                return alias->target();
        }
        if (auto* global = asGlobalObject(object); global == m_world.global() || global == m_world.page())
            return m_realm->globalThis();
        return (m_to == To::World ? m_world.inWorld() : m_world.inPage())->get(object).getObject();
    }

    JSObject* aliasIfPlatformObject(JSObject* object)
    {
        if (isCrossOrigin(object))
            return m_world.createAlias(object, nullptr, true);
        if (asWindow(object))
            return m_world.createAlias(object, m_realm->getPrototypeDirect().getObject(), true);
        auto* proxy = dynamicDowncast<ProxyObject>(object);
        JSObject* holder = proxy ? proxy->target() : object;
        if (holder->type() == ProxyObjectType || !holder->structure()->realm())
            return nullptr;
        if (proxy && isJSArray(holder))
            return aliasOfArray(object);
        bool isExotic = object->type() == CompiledObjectType ? hasElements(object) : object->structure()->typeInfo().overridesGetOwnPropertySlot() || hasIndexedProperties(object->indexingType());
        return isInterfaceCell(object) ? m_world.createAlias(object, m_world.prototypeOfInterface(Bindgen::interfaceOf(object)), isExotic) : nullptr;
    }

    // For an object of the platform that has no class.
    JSObject* namespaceFor(JSObject* object)
    {
        JSObject* held = createHolder(object->realm());
        forEachMember(object, [&](const Identifier& name, JSValue value, unsigned attributes) {
            bool isData = !value.isCallable() && !(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue);
            if (isData || isOfPlatform(m_vm, name, value, attributes))
                putAsItIs(object->realm(), held, name, value, attributes);
        });
        JSObject* members = m_world.createMembers(object, m_realm->objectPrototype(), { held, JSValue() });
        m_world.pair(members, object);
        return members;
    }

private:
    bool hasElements(JSObject* object)
    {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
        PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
        bool found = object->methodTable()->getOwnPropertySlotByIndex(object, m_realm, 0, slot);
        scope.clearExceptionExceptTermination();
        return found;
    }

    JSObject* aliasOfArray(JSObject* object)
    {
        JSObject* alias = m_world.createAlias(object, m_realm->arrayPrototype(), true);
        alias->putDirect(m_vm, m_vm.propertyNames->isConcatSpreadableSymbol, jsBoolean(true), static_cast<unsigned>(PropertyAttribute::DontEnum));
        return alias;
    }

    static bool hasOperations(JSObject* object)
    {
        bool found = false;
        forEachMember(object, [&](const Identifier&, JSValue value, unsigned) {
            auto* accessor = dynamicDowncast<GetterSetter>(value);
            found |= isOfBuiltinModule(accessor ? accessor->getter() : value);
        });
        return found;
    }

    static bool isCloned(JSObject* object)
    {
        switch (object->type()) {
        case JSDateType:
        case RegExpObjectType:
        case BooleanObjectType:
        case NumberObjectType:
        case StringObjectType:
        case WebAssemblyModuleType:
            return true;
        default:
            return false;
        }
    }

    static bool hasTwin(JSObject* object)
    {
        return object->inherits<Bindgen::Generated::JSBlob>() || object->inherits<WebCore::JSDOMException>() || object->inherits<WebCore::JSCryptoKey>();
    }

    JSValue toWorld(JSObject* object)
    {
        JSC::JSType type = object->type();
        bool isPlain = type == FinalObjectType || type == CompiledObjectType;
        bool isContainer = isPlain || type == ArrayType || type == JSPromiseType;
        if (object->structure()->realm() == m_realm && !isContainer)
            return object;
        if (object->isCallable() && !isInterfaceCell(object)) {
            if (type == ProxyObjectType)
                return jsNull();
            if (JSObject* constructor = m_world.interfaceObjectFor(object))
                return constructor;
            return isOfBuiltinModule(object) ? m_world.adopt(object) : jsNull();
        }
        if (hasTwin(object))
            return twinOf(object);
        if (type != ArrayType && type != JSPromiseType && type != ErrorInstanceType) {
            if (JSObject* alias = aliasIfPlatformObject(object))
                return alias;
        }
        switch (type) {
        case ProxyObjectType:
            return jsNull();
        case DerivedArrayType:
            if (object->structure()->typeInfo().overridesPut())
                return aliasOfArray(object);
            break;
        case JSArrayIteratorType:
            return shadowed(object, m_realm->arrayIteratorPrototype());
        case JSMapIteratorType:
            return shadowed(object, m_realm->mapIteratorPrototype());
        case JSSetIteratorType:
            return shadowed(object, m_realm->setIteratorPrototype());
        case JSGeneratorType:
            return shadowed(object, m_realm->generatorPrototype());
        case JSAsyncGeneratorType:
            return shadowed(object, m_realm->asyncGeneratorPrototype());
        default:
            break;
        }
        if (isPlain && object->structure()->realm() != m_realm && hasOperations(object))
            return namespaceFor(object);
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSValue copy = copyOf(object);
        RETURN_IF_EXCEPTION(scope, {});
        if (copy)
            return copy;
        if (JSObject* own = m_world.nativePrototype(m_realm, object->classInfo()->className))
            return shadowed(object, own);
        JSObject* prototype = object->getPrototypeDirect().getObject();
        return m_world.createAlias(object, prototype ? m_world.prototypeLike(prototype) : nullptr, false);
    }

    JSObject* shadowed(JSObject* object, JSObject* prototype) { return m_world.createAlias(object, m_world.prototypeShadowing(prototype), false); }

    JSValue toPage(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (object->structure()->realm() == m_realm)
            return object;
        if (object->isCallable()) {
            JSObject* function = m_world.createFunction(m_realm, 0, emptyString(), callInWorld, { m_world.global(), object });
            m_world.pair(object, function);
            return function;
        }
        if (hasTwin(object))
            RELEASE_AND_RETURN(scope, twinOf(object));
        if (auto* signal = dynamicDowncast<WebCore::JSAbortSignal>(object)) {
            auto* realm = uncheckedDowncast<Zig::GlobalObject>(m_realm);
            JSValue follower = WebCore::toJS(realm, realm, WebCore::AbortSignal::any(*realm->scriptExecutionContext(), { &signal->wrapped() }).get());
            RETURN_IF_EXCEPTION(scope, {});
            m_world.pair(object, asObject(follower));
            return follower;
        }
        if (auto* url = dynamicDowncast<WebCore::JSDOMURL>(object))
            return jsString(m_vm, url->wrapped().href().string());
        if (auto* parameters = dynamicDowncast<WebCore::JSURLSearchParams>(object)) {
            auto* realm = uncheckedDowncast<Zig::GlobalObject>(m_realm);
            RELEASE_AND_RETURN(scope, WebCore::toJSNewlyCreated(realm, realm, WebCore::URLSearchParams::create(parameters->wrapped().toString(), nullptr).releaseReturnValue()));
        }
        if (auto* data = dynamicDowncast<WebCore::JSDOMFormData>(object)) {
            auto* realm = uncheckedDowncast<Zig::GlobalObject>(m_realm);
            auto copy = WebCore::DOMFormData::create(realm->scriptExecutionContext());
            copyEntriesToAnotherRealm(data->wrapped(), copy);
            RELEASE_AND_RETURN(scope, WebCore::toJSNewlyCreated(realm, realm, WTF::move(copy)));
        }
        if (!m_isData && (object->type() == FinalObjectType || object->type() == ProxyObjectType || object->type() == CompiledObjectType)) {
            for (ASCIILiteral name : { "handleEvent"_s, "acceptNode"_s, "lookupNamespaceURI"_s }) {
                auto method = Identifier::fromString(m_vm, name);
                bool has = object->hasProperty(m_world.global(), method);
                RETURN_IF_EXCEPTION(scope, {});
                if (!has)
                    continue;
                JSObject* callback = constructEmptyObject(m_realm);
                callback->putDirect(m_vm, method, m_world.createFunction(m_realm, 1, name, callMethodInWorld, { m_world.global(), object, jsString(m_vm, String(name)) }));
                m_world.pair(object, callback);
                return callback;
            }
        }
        JSValue copy = copyOf(object);
        RETURN_IF_EXCEPTION(scope, {});
        if (copy)
            return copy;
        if (!m_isData) {
            copy = standInFor(object);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return copy ? copy : remember(object, constructEmptyObject(m_realm));
    }

    // For what is consumed piece by piece.
    JSValue standInFor(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto* world = m_world.global();
        bool isReadable = object->inherits<WebCore::JSReadableStream>();
        if (isReadable || object->inherits<WebCore::JSWritableStream>()) {
            String name = object->classInfo()->className;
            JSObject* constructor = Constructor::create(world, world->functionPrototype(), 0, name);
            constructor->putDirect(m_vm, recordName(m_vm), createRecord(m_vm, { m_world.nativeConstructor(m_realm, name), jsUndefined(), jsUndefined() }));
            // It is locked when the page first asks for something.
            JSObject* lock = createHolder(world);
            JSObject* steps = constructEmptyObject(world);
            auto forward = [&](ASCIILiteral step, ASCIILiteral method) {
                steps->putDirect(m_vm, Identifier::fromString(m_vm, step), m_world.createFunction(world, 1, step, callEndOfStream, { object, lock, jsNontrivialString(m_vm, method) }));
            };
            MarkedArgumentBuffer arguments;
            arguments.append(steps);
            if (isReadable) {
                forward("pull"_s, "read"_s);
                forward("cancel"_s, "cancel"_s);
                JSObject* strategy = constructEmptyObject(world);
                strategy->putDirect(m_vm, Identifier::fromString(m_vm, "highWaterMark"_s), jsNumber(0));
                arguments.append(strategy);
            } else {
                for (ASCIILiteral step : { "write"_s, "close"_s, "abort"_s })
                    forward(step, step);
            }
            JSValue alias = construct(world, constructor, arguments, ""_s);
            RETURN_IF_EXCEPTION(scope, {});
            return pairWith(object, targetOf(asObject(alias)));
        }
        if (StringView(object->classInfo()->className).endsWith("Stream"_s)) {
            JSObject* ends = constructEmptyObject(m_realm);
            for (ASCIILiteral end : { "readable"_s, "writable"_s }) {
                auto name = Identifier::fromString(m_vm, end);
                JSValue value = object->get(world, name);
                RETURN_IF_EXCEPTION(scope, {});
                value = convert(value);
                RETURN_IF_EXCEPTION(scope, {});
                ends->putDirect(m_vm, name, value);
            }
            return remember(object, ends);
        }
        if (object->type() < JSGeneratorType || object->type() > JSAsyncFromSyncIteratorType)
            return {};
        JSObject* iterator = constructEmptyObject(m_realm, object->type() == JSAsyncGeneratorType ? static_cast<JSObject*>(m_realm->asyncIteratorPrototype()) : m_realm->iteratorPrototype());
        for (ASCIILiteral name : { "next"_s, "return"_s, "throw"_s }) {
            auto method = Identifier::fromString(m_vm, name);
            bool has = object->hasProperty(world, method);
            RETURN_IF_EXCEPTION(scope, {});
            if (has)
                iterator->putDirect(m_vm, method, m_world.createFunction(m_realm, 0, name, callMethodInWorld, { world, object, jsString(m_vm, String(name)) }));
        }
        return pairWith(object, iterator);
    }

    // What comes back from the page is what was sent.
    JSValue remember(JSObject* object, JSValue copy)
    {
        if (m_to == To::Page && copy.isObject())
            m_world.inWorld()->set(m_vm, asObject(copy), object);
        m_seen.add(object, copy);
        m_copies.append(object);
        m_copies.append(copy);
        return copy;
    }

    JSValue clone(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto serialized = WebCore::SerializedScriptValue::create(*m_realm, object);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, serialized->deserialize(*m_realm, m_realm));
    }

    JSValue twinOf(JSObject* object)
    {
        JSValue twin;
        if (void* blob = Blob__dupeFromJS(JSValue::encode(object))) {
            twin = Bindgen::createWrapper<Bindgen::Generated::JSBlob>(m_realm, blob);
            desktopRealmAdoptFile(m_realm, twin);
        } else
            twin = clone(object);
        return twin && twin.isObject() ? pairWith(object, asObject(twin)) : twin;
    }

    // Empty for what cannot be copied.
    JSValue copyOf(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (isCloned(object)) {
            JSValue copy = clone(object);
            RETURN_IF_EXCEPTION(scope, {});
            return remember(object, copy);
        }
        if (auto* buffer = dynamicDowncast<JSArrayBuffer>(object)) {
            RefPtr bytes = sameBytes(buffer->impl(), buffer->impl()->span());
            if (!bytes)
                RELEASE_AND_RETURN(scope, clone(object));
            return pairWith(object, JSArrayBuffer::create(m_vm, m_realm->arrayBufferStructure(ArrayBufferSharingMode::Default), WTF::move(bytes)));
        }
        if (auto* view = dynamicDowncast<JSArrayBufferView>(object))
            RELEASE_AND_RETURN(scope, viewOfTheSameBytes(view));
        if (auto* promise = dynamicDowncast<JSPromise>(object))
            RELEASE_AND_RETURN(scope, follow(promise));
        if (auto* error = dynamicDowncast<ErrorInstance>(object)) {
            JSValue message = ownValue(error, m_vm.propertyNames->message);
            String text = message.isString() ? asString(message)->value(m_realm) : String();
            RETURN_IF_EXCEPTION(scope, {});
            ErrorType type = error->errorType() > ErrorType::URIError ? ErrorType::Error : error->errorType();
            auto* copy = ErrorInstance::create(m_vm, m_realm->errorStructure(type), text, JSValue(), nullptr, TypeNothing, type);
            if (JSValue name = ownValue(error, m_vm.propertyNames->name); name.isString())
                copy->putDirect(m_vm, m_vm.propertyNames->name, name, static_cast<unsigned>(PropertyAttribute::DontEnum));
            return remember(object, copy);
        }
        if (auto* map = dynamicDowncast<JSMap>(object)) {
            auto* copy = JSMap::create(m_vm, m_realm->mapStructure());
            remember(object, copy);
            auto* iterator = JSMapIterator::create(m_vm, m_realm->mapIteratorStructure(), map, IterationKind::Entries);
            for (JSValue key, value; iterator->nextKeyValue(m_realm, key, value);) {
                key = convert(key);
                RETURN_IF_EXCEPTION(scope, {});
                value = convert(value);
                RETURN_IF_EXCEPTION(scope, {});
                copy->set(m_realm, key, value);
                RETURN_IF_EXCEPTION(scope, {});
            }
            return copy;
        }
        if (auto* set = dynamicDowncast<JSSet>(object)) {
            auto* copy = JSSet::create(m_vm, m_realm->setStructure());
            remember(object, copy);
            auto* iterator = JSSetIterator::create(m_vm, m_realm->setIteratorStructure(), set, IterationKind::Values);
            for (JSValue value; iterator->next(m_realm, value);) {
                value = convert(value);
                RETURN_IF_EXCEPTION(scope, {});
                copy->add(m_realm, value);
                RETURN_IF_EXCEPTION(scope, {});
            }
            return copy;
        }
        bool isList = isJSArray(object) || object->type() == DerivedArrayType;
        if (!isList && object->type() != FinalObjectType && object->type() != CompiledObjectType && object->type() != ProxyObjectType)
            return {};
        JSObject* copy = isList ? static_cast<JSObject*>(constructEmptyArray(m_realm, nullptr, uncheckedDowncast<JSArray>(object)->length())) : constructEmptyObject(m_realm);
        RETURN_IF_EXCEPTION(scope, {});
        remember(object, copy);
        bool isDictionary = m_to == To::Page && !m_isData && !isList && object->type() != ProxyObjectType;
        isDictionary ? copyDictionary(object, copy) : copyProperties(object, copy);
        RETURN_IF_EXCEPTION(scope, {});
        if (isList && m_to == To::World && object->structure()->isFrozen(m_vm)) {
            objectConstructorFreeze(m_realm, copy);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return copy;
    }

    // With what it inherits from scripts. An accessor is called when the page reads the member.
    bool copyDictionary(JSObject* object, JSObject* to)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto* world = m_world.global();
        for (JSObject* from = object; from && from->realmMayBeNull() && from != from->realm()->objectPrototype() && !from->inherits<Members>() && from->type() != ProxyObjectType && from->type() != GlobalProxyType; from = from->getPrototypeDirect().getObject()) {
            forEachMember(from, [&](const Identifier& name, JSValue member, unsigned attributes) {
                if (scope.exception() || to->getDirect(m_vm, name) || (from != object && name == m_vm.propertyNames->constructor) || (name.isSymbol() && name != m_vm.propertyNames->toPrimitiveSymbol && name != m_vm.propertyNames->iteratorSymbol && name != m_vm.propertyNames->asyncIteratorSymbol))
                    return;
                bool holdsData = WTF::equal(name.impl(), "info"_s) || (m_isForConstructor && holdsAnyValue(name));
                unsigned visibility = from == object ? attributes & PropertyAttribute::DontEnum : static_cast<unsigned>(PropertyAttribute::DontEnum);
                if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) {
                    JSValue value = holdsData ? convertData(member) : convert(member);
                    if (!scope.exception())
                        to->putDirect(m_vm, name, value, visibility);
                    return;
                }
                JSObject* getter = m_world.createFunction(m_realm, 0, emptyString(), getInWorld, { world, object, identifierToJSValue(m_vm, name), jsBoolean(holdsData) });
                to->putDirectAccessor(m_realm, name, GetterSetter::create(m_vm, m_realm, getter, nullptr), visibility | PropertyAttribute::Accessor);
            });
            RETURN_IF_EXCEPTION(scope, false);
        }
        if (object->type() == FinalObjectType && !hasIndexedProperties(object->indexingType()))
            return true;
        RELEASE_AND_RETURN(scope, copyProperties(object, to, true));
    }

    // The accessors of the page are left out.
    bool copyProperties(JSObject* from, JSObject* to, bool onlyIndices = false)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto* world = m_world.global();
        PropertyNameArrayBuilder names(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        from->methodTable()->getOwnPropertyNames(from, world, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        for (auto& name : names) {
            if (onlyIndices && !parseIndex(name))
                continue;
            JSValue value;
            if (m_to == To::Page)
                value = from->get(world, name);
            else {
                PropertySlot slot(from, PropertySlot::InternalMethodType::GetOwnProperty);
                bool found = from->methodTable()->getOwnPropertySlot(from, world, name, slot);
                RETURN_IF_EXCEPTION(scope, false);
                if (!found || slot.isAccessor())
                    continue;
                value = slot.getValue(world, name);
            }
            RETURN_IF_EXCEPTION(scope, false);
            value = convert(value);
            RETURN_IF_EXCEPTION(scope, false);
            to->putDirectMayBeIndex(m_realm, name, value);
            RETURN_IF_EXCEPTION(scope, false);
        }
        return true;
    }

    JSValue follow(JSPromise* promise)
    {
        auto* follower = JSPromise::create(m_vm, m_realm->promiseStructure());
        bool wasHandled = promise->isHandled();
        auto reaction = [&](bool isRejection) {
            return JSNativeStdFunction::create(
                m_vm, m_realm, 1, emptyString(), [follower, world = m_world.global(), to = m_to, isRejection, wasHandled](JSGlobalObject* realm, CallFrame* callFrame) {
                    VM& vm = realm->vm();
                    auto scope = DECLARE_THROW_SCOPE(vm);
                    JSValue value = Crossing(World(world), to).convert(callFrame->argument(0));
                    if (auto* exception = scope.exception()) [[unlikely]] {
                        if (scope.tryClearException())
                            follower->reject(vm, to == To::World ? exception->value() : jsUndefined());
                        return encodedJSUndefined();
                    }
                    if (isRejection && to == To::Page && !follower->isHandled()) {
                        follower->markAsHandled();
                        if (!wasHandled)
                            JSPromise::create(vm, world->promiseStructure())->reject(vm, callFrame->argument(0));
                    }
                    isRejection ? follower->reject(vm, value) : to == To::World ? follower->resolve(realm, vm, value)
                                                                                : follower->fulfill(vm, value);
                    return encodedJSUndefined();
                },
                JSValue(follower), JSValue(m_world.global()));
        };
        promise->performPromiseThenExported(m_vm, m_realm, reaction(false), reaction(true), jsUndefined());
        if (wasHandled && m_to == To::World)
            follower->markAsHandled();
        return promise->realm() == m_realm ? follower : pairWith(promise, follower);
    }

    // An ArrayBuffer has one object, so each side needs its own. Neither can be detached: a transfer copies it.
    static RefPtr<ArrayBuffer> sameBytes(RefPtr<ArrayBuffer> buffer, std::span<const uint8_t> span)
    {
        if (!buffer || span.empty() || buffer->isShared() || buffer->isWasmMemory() || buffer->isResizableOrGrowableShared())
            return nullptr;
        buffer->pin();
        RefPtr bytes = ArrayBuffer::createFromBytes(span, createSharedTask<void(void*)>([buffer](void*) { buffer->unpin(); }));
        bytes->pin();
        return bytes;
    }

    JSObject* pairWith(JSObject* object, JSObject* twin)
    {
        m_to == To::World ? m_world.pair(twin, object) : m_world.pair(object, twin);
        return twin;
    }

    JSValue viewOfTheSameBytes(JSArrayBufferView* view)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        RefPtr buffer = view->possiblySharedBuffer();
        RefPtr bytes = view->isDetached() ? nullptr : sameBytes(buffer, view->span());
        if (!bytes)
            RELEASE_AND_RETURN(scope, clone(view));
        auto type = typedArrayType(view->type());
        Structure* structure = m_realm->typedArrayStructure(type, false);
        JSObject* twin = nullptr;
        switch (type) {
#define CREATE_VIEW(name)                                                                        \
    case Type##name:                                                                             \
        twin = JS##name##Array::create(m_realm, structure, WTF::move(bytes), 0, view->length()); \
        break;
            FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(CREATE_VIEW)
#undef CREATE_VIEW
        default:
            twin = JSDataView::create(m_realm, structure, WTF::move(bytes), 0, view->byteLength());
        }
        RETURN_IF_EXCEPTION(scope, {});
        return pairWith(view, twin);
    }

    World m_world;
    VM& m_vm;
    To m_to;
    bool m_isData { false };
    bool m_isForConstructor { false };
    JSGlobalObject* m_realm;
    UncheckedKeyHashMap<JSObject*, JSValue> m_seen;
    MarkedArgumentBuffer m_copies;
};

std::pair<JSValue, unsigned> World::memberFor(PropertyName name, JSValue value, unsigned attributes, bool isOfBody)
{
    static constexpr unsigned visibility = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete;
    String text = name.isSymbol() ? makeString('[', String(name.uid()), ']') : String(name.uid());
    if (text.startsWith("on"_s) && text != "onLine"_s && attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue) {
        JSValue key = jsString(m_vm, text);
        return { GetterSetter::create(m_vm, m_global, createFunction(m_global, 0, makeString("get "_s, text), getHandler, { key, jsBoolean(isOfBody) }), createFunction(m_global, 1, makeString("set "_s, text), setHandler, { key, jsBoolean(isOfBody) })), (attributes & visibility) | PropertyAttribute::Accessor };
    }
    if (auto* accessor = dynamicDowncast<GetterSetter>(value)) {
        JSObject* getter = accessor->isGetterNull() ? nullptr : functionFor(accessor->getter(), makeString("get "_s, text), true);
        JSObject* setter = accessor->isSetterNull() ? nullptr : functionFor(accessor->setter(), makeString("set "_s, text));
        return { GetterSetter::create(m_vm, m_global, getter, setter), (attributes & visibility) | PropertyAttribute::Accessor };
    }
    if (auto* accessor = dynamicDowncast<CustomGetterSetter>(value)) {
        JSValue key = identifierToJSValue(m_vm, Identifier::fromUid(m_vm, name.uid()));
        JSObject* getter = createFunction(m_global, 0, makeString("get "_s, text), getInPage, { accessor, key });
        JSObject* setter = accessor->setter() ? createFunction(m_global, 1, makeString("set "_s, text), setInPage, { accessor, key }) : nullptr;
        return { GetterSetter::create(m_vm, m_global, getter, setter), (attributes & visibility) | PropertyAttribute::Accessor };
    }
    attributes &= visibility | PropertyAttribute::ReadOnly;
    if (!value.isObject())
        return { value, attributes };
    JSObject* object = asObject(value);
    if (!object->realmMayBeNull())
        return { jsNull(), attributes };
    if (name == m_vm.propertyNames->constructor) {
        JSObject* constructor = interfaceObjectFor(object);
        return { constructor ? constructor : object->realm() == m_global ? value
                                                                         : jsUndefined(),
            attributes };
    }
    if (object->isCallable()) {
        JSValue own = arrayFunctionLike(object);
        return { own ? own : functionFor(object), attributes };
    }
    if (object->realm() == m_global)
        return { value, attributes };
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
    JSValue copy = Crossing(*this, To::World).convert(value);
    scope.clearExceptionExceptTermination();
    if (auto* names = copy && name == m_vm.propertyNames->unscopablesSymbol ? dynamicDowncast<JSFinalObject>(copy) : nullptr)
        names->setPrototypeDirect(m_vm, jsNull());
    return { copy ? copy : jsUndefined(), attributes };
}

std::pair<JSValue, unsigned> World::memberOfWindow(JSObject* window, PropertyName name, const HashTableValue& row)
{
    unsigned attributes = attributesForStructure(row.attributes());
    if (row.attributes() & PropertyAttribute::Function)
        return memberFor(name, JSFunction::create(m_vm, window->realm(), row.functionLength(), String(name.uid()), row.function(), ImplementationVisibility::Public), attributes);
    if (row.attributes() & PropertyAttribute::CustomValue) {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSValue value = JSValue::decode(Crossing(*this, To::World).convertOutcome([&] {
            return behindBarrier([&] {
                auto scope = DECLARE_THROW_SCOPE(m_vm);
                JSValue ofPage = JSValue::decode(row.propertyGetter()(window->realm(), JSValue::encode(window), name));
                RETURN_IF_EXCEPTION(scope, JSValue());
                RELEASE_AND_RETURN(scope, adopt(ofPage));
            });
        }));
        RETURN_IF_EXCEPTION(scope, {});
        return { value, attributes & (PropertyAttribute::DontEnum | PropertyAttribute::DontDelete) };
    }
    return memberFor(name, CustomGetterSetter::create(m_vm, row.propertyGetter(), row.propertyPutter()), attributes);
}

JSValue World::adopt(JSValue value)
{
    Crossing crossing(*this, To::World);
    JSObject* object = value ? value.getObject() : nullptr;
    if (!object)
        return value;
    if (JSObject* known = crossing.counterpartOf(object))
        return known;
    if (auto number = Bindgen::interfaceWithConstructor(object->realm(), object))
        return constructorOfInterface(*number);
    if (!object->isCallable()) {
        JSObject* alias = crossing.aliasIfPlatformObject(object);
        return alias ? alias : crossing.namespaceFor(object);
    }
    if (JSObject* constructor = interfaceObjectFor(object))
        return constructor;
    JSObject* prototype = ownValue(object, m_vm.propertyNames->prototype).getObject();
    JSValue name = ownValue(object, m_vm.propertyNames->name);
    if (prototype && name.isString() && nativeConstructor(object->realm(), asString(name)->tryGetValue()) == object)
        return nativeConstructor(m_global, asString(name)->tryGetValue());
    if (!object->isConstructor()) {
        JSObject* function = functionFor(object);
        pair(function, object);
        putStatics(object, function);
        return function;
    }
    JSObject* function = createConstructor(object, prototype ? prototypeFor(prototype) : nullptr);
    putStatics(object, function);
    return function;
}

void Members::reify(PropertyName name)
{
    VM& vm = this->vm();
    auto* sources = name.isPrivateName() || getDirect(vm, name) ? nullptr : recordOf(vm, this);
    for (unsigned i = 0; sources && i < sources->length(); ++i) {
        JSObject* source = sources->get(i).getObject();
        unsigned attributes = 0;
        JSValue value = source && !parseIndex(name) ? ownMember(source, name, attributes) : JSValue();
        if (!value || (i + 1 == sources->length() && !isOfPlatform(vm, name, value, attributes)))
            continue;
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        World world(realm());
        world.behindBarrier([&] {
            JSValue tag = source->getDirect(vm, vm.propertyNames->toStringTagSymbol);
            String className = tag && tag.isString() ? String(asString(tag)->tryGetValue()) : String();
            bool isOfBody = className == "HTMLBodyElement"_s || className == "HTMLFrameSetElement"_s;
            auto [member, memberAttributes] = world.memberFor(name, value, attributes, isOfBody);
            if (!getDirect(vm, name))
                putAsItIs(realm(), this, name, member, memberAttributes);
            return jsUndefined();
        });
        scope.clearExceptionExceptTermination();
        return;
    }
}

void Members::reifyAll()
{
    VM& vm = this->vm();
    auto* sources = recordOf(vm, this);
    for (unsigned i = 0; sources && i < sources->length(); ++i) {
        if (JSObject* source = sources->get(i).getObject())
            forEachMember(source, [&](const Identifier& name, JSValue, unsigned) { reify(name); });
    }
    putDirect(vm, recordName(vm), jsUndefined());
}

JSObject* ExoticAlias::window() { return asWindow(target()); }

bool ExoticAlias::storesUnder(PropertyName name) { return !name.isSymbol() && !window() && !isArray() && takesNames(); }

bool ExoticAlias::isArray()
{
    auto* proxy = dynamicDowncast<ProxyObject>(target());
    return target()->type() == DerivedArrayType || (proxy && isJSArray(proxy->target()));
}

// What the world has under a name comes before what the document has.
bool ExoticAlias::isOrdinary(JSGlobalObject* globalObject, PropertyName name)
{
    VM& vm = globalObject->vm();
    if (parseIndex(name))
        return false;
    if (name.isSymbol() || getDirect(vm, name))
        return true;
    if (isArray())
        return name != vm.propertyNames->length;
    if (auto* window = this->window())
        return !WebGlobalObject::rowOfPlatform(window, name);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* prototype = isCrossOrigin(target()) ? nullptr : getPrototypeDirect().getObject();
    bool isInherited = prototype && prototype->hasProperty(globalObject, name);
    RETURN_IF_EXCEPTION(scope, true);
    if (isInherited)
        return true;
    auto* proxy = dynamicDowncast<ProxyObject>(target());
    return !takesNames() && (proxy ? proxy->target() : target())->getDirect(vm, name);
}

bool ExoticAlias::takesNames()
{
    if (window() || isCrossOrigin(target()) || isArray())
        return true;
    return target()->classInfo()->className == "DOMStringMap"_s || target()->classInfo()->className == "Storage"_s;
}

bool ExoticAlias::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* alias = uncheckedDowncast<ExoticAlias>(object);
    if (slot.isVMInquiry()) {
        slot.setIsTaintedByOpaqueObject();
        RELEASE_AND_RETURN(scope, Base::getOwnPropertySlot(object, globalObject, name, slot));
    }
    bool isOrdinary = alias->isOrdinary(globalObject, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (isOrdinary)
        RELEASE_AND_RETURN(scope, Base::getOwnPropertySlot(object, globalObject, name, slot));
    World world(alias->realm());
    JSObject* target = alias->target();
    if (auto* window = parseIndex(name) ? nullptr : alias->window()) {
        auto& row = *WebGlobalObject::rowOfPlatform(window, name);
        if (row.attributes() & PropertyAttribute::DontEnum) {
            JSValue own = world.global()->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, false);
            slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum), own);
            return true;
        }
        auto [member, attributes] = world.memberOfWindow(window, name, row);
        RETURN_IF_EXCEPTION(scope, false);
        if (attributes & PropertyAttribute::Accessor)
            slot.setGetterSlot(object, attributes, uncheckedDowncast<GetterSetter>(member));
        else
            slot.setValue(object, attributes, member);
        return true;
    }
    std::optional<unsigned> attributes;
    JSValue value = JSValue::decode(Crossing(world, To::World).convertOutcome([&] {
        return world.behindBarrier([&] {
            auto scope = DECLARE_THROW_SCOPE(vm);
            PropertySlot found(target, PropertySlot::InternalMethodType::GetOwnProperty);
            bool hasProperty = target->methodTable()->getOwnPropertySlot(target, world.page(), name, found);
            RETURN_IF_EXCEPTION(scope, JSValue());
            if (!hasProperty)
                return jsUndefined();
            attributes = found.attributes() & (PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
            RELEASE_AND_RETURN(scope, found.getValue(world.page(), name));
        });
    }));
    RETURN_IF_EXCEPTION(scope, false);
    if (!attributes)
        return false;
    slot.setValue(object, *attributes, value);
    return true;
}

bool ExoticAlias::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    return getOwnPropertySlot(object, globalObject, Identifier::from(globalObject->vm(), index), slot);
}

void ExoticAlias::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* alias = uncheckedDowncast<ExoticAlias>(object);
    World world(alias->realm());
    PropertyNameArrayBuilder ofTarget(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    Crossing(world, To::World).convertOutcome([&] {
        return world.behindBarrier([&] {
            alias->target()->methodTable()->getOwnPropertyNames(alias->target(), world.page(), ofTarget, mode);
            return jsUndefined();
        });
    });
    RETURN_IF_EXCEPTION(scope, );
    for (auto& name : ofTarget) {
        bool isOrdinary = alias->isOrdinary(globalObject, name);
        RETURN_IF_EXCEPTION(scope, );
        if (!isOrdinary)
            names.add(name);
    }
    scope.release();
    Base::getOwnPropertyNames(object, globalObject, names, mode);
}

bool ExoticAlias::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* alias = uncheckedDowncast<ExoticAlias>(cell);
    bool isOrdinary = slot.thisValue() != cell || (!alias->storesUnder(name) && alias->isOrdinary(globalObject, name));
    RETURN_IF_EXCEPTION(scope, false);
    if (isOrdinary || !(parseIndex(name) || alias->takesNames()))
        RELEASE_AND_RETURN(scope, Base::put(cell, globalObject, name, value, slot));
    World world(alias->realm());
    if (alias->window() && !parseIndex(name)) {
        PropertySlot found(alias, PropertySlot::InternalMethodType::GetOwnProperty);
        getOwnPropertySlot(alias, globalObject, name, found);
        RETURN_IF_EXCEPTION(scope, false);
        if (found.isAccessor())
            RELEASE_AND_RETURN(scope, found.getterSetter()->callSetter(globalObject, alias, value, slot.isStrictMode()));
        alias->putDirect(world.vm(), name, value);
        return true;
    }
    value = Crossing(world, To::Page).convert(value);
    RETURN_IF_EXCEPTION(scope, false);
    bool didPut = false;
    Crossing(world, To::World).convertOutcome([&] {
        return world.behindBarrier([&] {
            PutPropertySlot targetSlot(alias->target(), slot.isStrictMode());
            didPut = alias->target()->methodTable()->put(alias->target(), world.page(), name, value, targetSlot);
            return jsUndefined();
        });
    });
    RETURN_IF_EXCEPTION(scope, false);
    slot.disableCaching();
    return didPut;
}

bool ExoticAlias::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    PutPropertySlot slot(cell, shouldThrow);
    return put(cell, globalObject, Identifier::from(globalObject->vm(), index), value, slot);
}

bool ExoticAlias::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* alias = uncheckedDowncast<ExoticAlias>(object);
    bool isOrdinary = !alias->storesUnder(name) && alias->isOrdinary(globalObject, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (isOrdinary || alias->window())
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow));
    if (!parseIndex(name) && !alias->takesNames()) {
        PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
        bool isSupported = getOwnPropertySlot(object, globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, false);
        if (isSupported)
            return typeError(globalObject, scope, shouldThrow, "The named property is read-only"_s);
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow));
    }
    if (!descriptor.value())
        return typeError(globalObject, scope, shouldThrow, "Only a value can be defined"_s);
    PutPropertySlot slot(object, shouldThrow);
    RELEASE_AND_RETURN(scope, put(object, globalObject, name, descriptor.value(), slot));
}

bool ExoticAlias::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* alias = uncheckedDowncast<ExoticAlias>(cell);
    bool isOrdinary = alias->isOrdinary(globalObject, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (isOrdinary || alias->window())
        RELEASE_AND_RETURN(scope, Base::deleteProperty(cell, globalObject, name, slot));
    World world(alias->realm());
    bool didDelete = false;
    Crossing(world, To::World).convertOutcome([&] {
        return world.behindBarrier([&] {
            didDelete = JSCell::deleteProperty(alias->target(), world.page(), name);
            return jsUndefined();
        });
    });
    RETURN_IF_EXCEPTION(scope, false);
    slot.disableCaching();
    return didDelete;
}

bool ExoticAlias::deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index)
{
    DeletePropertySlot slot;
    return deleteProperty(cell, globalObject, Identifier::from(globalObject->vm(), index), slot);
}

static JSCellButterfly* recordOfCallee(CallFrame* callFrame) { return recordOf(callFrame->jsCallee()->vm(), callFrame->jsCallee()); }

JSC_DEFINE_HOST_FUNCTION(runBehindBarrier, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode((*std::exchange(whatRunsBehindBarrier, nullptr))());
}

static JSValue callMethod(JSGlobalObject* realm, JSValue object, const String& name, JSValue argument)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSValue method = object.get(realm, Identifier::fromString(realm->vm(), name));
    RETURN_IF_EXCEPTION(scope, {});
    EncodedJSValue given = JSValue::encode(argument);
    RELEASE_AND_RETURN(scope, call(realm, method, object, ArgList { &given, 1 }, "The value is not a function"_s));
}

JSC_DEFINE_HOST_FUNCTION(passOnChunk, (JSGlobalObject * world, CallFrame* callFrame))
{
    VM& vm = world->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isDone = callFrame->argument(0).get(world, vm.propertyNames->done).toBoolean(world);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue chunk = callFrame->argument(0).get(world, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(callMethod(world, recordOfCallee(callFrame)->get(0), isDone ? "close"_s : "enqueue"_s, chunk)));
}

JSC_DEFINE_HOST_FUNCTION(callEndOfStream, (JSGlobalObject * world, CallFrame* callFrame))
{
    VM& vm = world->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* record = recordOfCallee(callFrame);
    JSValue end = asObject(record->get(1))->getDirect(vm, vm.propertyNames->value);
    if (!end) {
        end = callMethod(world, record->get(0), record->get(0).inherits<WebCore::JSReadableStream>() ? "getReader"_s : "getWriter"_s, jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
        asObject(record->get(1))->putDirect(vm, vm.propertyNames->value, end);
    }
    String method = asString(record->get(2))->tryGetValue();
    JSValue result = callMethod(world, end, method, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    if (method != "read"_s)
        return JSValue::encode(result);
    auto* promise = JSPromise::resolvedPromise(world, result);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(promise->then(world, World(world).createFunction(world, 1, emptyString(), passOnChunk, { callFrame->argument(0) }), jsUndefined())));
}

extern "C" EncodedJSValue Bun__DesktopRealm__inject(JSGlobalObject*, EncodedJSValue source, EncodedJSValue window, bool awaits);
extern "C" void Bun__DOM__reportException(JSGlobalObject*, EncodedJSValue value, EncodedJSValue exception);

JSC_DEFINE_HOST_FUNCTION(runTimer, (JSGlobalObject * world, CallFrame* callFrame))
{
    auto* record = recordOfCallee(callFrame);
    JSValue handler = record->get(0);
    if (handler.isString()) {
        Bun__DesktopRealm__inject(world, JSValue::encode(handler), encodedJSUndefined(), false);
        return encodedJSUndefined();
    }
    auto* given = uncheckedDowncast<JSCellButterfly>(record->get(1));
    MarkedArgumentBuffer arguments;
    for (unsigned i = 0; i < given->length(); ++i)
        arguments.append(given->get(i));
    call(world, handler, getCallData(handler), world->globalThis(), arguments);
    return encodedJSUndefined();
}

// The timer is one of the page. What it runs stays here.
JSC_DEFINE_HOST_FUNCTION(startTimer, (JSGlobalObject * world, CallFrame* callFrame))
{
    VM& vm = world->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue handler = callFrame->argument(0);
    if (!handler.isCallable()) {
        handler = handler.toString(world);
        RETURN_IF_EXCEPTION(scope, {});
    }
    unsigned count = std::max<size_t>(callFrame->argumentCount(), 2) - 2;
    auto* given = JSCellButterfly::create(vm, CopyOnWriteArrayWithContiguous, count);
    for (unsigned i = 0; i < count; ++i)
        given->setIndex(vm, i, callFrame->uncheckedArgument(i + 2));
    MarkedArgumentBuffer arguments;
    arguments.append(World(world).createFunction(world, 0, emptyString(), runTimer, { handler, given }));
    arguments.append(callFrame->argument(1));
    JSValue start = recordOfCallee(callFrame)->get(0);
    RELEASE_AND_RETURN(scope, JSValue::encode(call(world, start, getCallData(start), jsUndefined(), arguments)));
}

JSC_DEFINE_HOST_FUNCTION(reportError, (JSGlobalObject * world, CallFrame* callFrame))
{
    Bun__DOM__reportException(world, JSValue::encode(callFrame->argument(0)), {});
    return encodedJSUndefined();
}

void enter(WebGlobalObject* global, JSGlobalObject* page)
{
    VM& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    World::create(global, page);
    World world(global);
    JSObject* prototype = world.prototypeOfInterface(Bindgen::interfaceOf(Bindgen::existingReceiverOf(page, jsUndefined())));
    prototype->didBecomePrototype(vm);
    global->setPrototypeDirect(vm, prototype);
    global->globalThis()->setPrototypeDirect(vm, prototype);
    JSObject* members = createHolder(global);
    for (ASCIILiteral text : { "setInterval"_s, "setTimeout"_s }) {
        auto name = Identifier::fromString(vm, text);
        members->putDirect(vm, name, world.createFunction(global, 1, text, startTimer, { world.memberOfWindow(page, name, *WebGlobalObject::rowOfPlatform(page, name)).first }));
    }
    members->putDirect(vm, Identifier::fromString(vm, "customElements"_s), jsNull());
    members->putDirect(vm, Identifier::fromString(vm, "reportError"_s), world.createFunction(global, 1, "reportError"_s, reportError, {}));
    auto clone = Identifier::fromString(vm, "structuredClone"_s);
    JSValue native = global->natives()->get(global, clone);
    RETURN_IF_EXCEPTION(scope, );
    members->putDirect(vm, clone, native);
    global->setMembers(vm, members);
}

JSValue inPage(JSGlobalObject* world, JSValue value, JSValue (*steps)(JSGlobalObject*, JSValue))
{
    auto scope = DECLARE_THROW_SCOPE(world->vm());
    JSValue given = toPage(world, value);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue result = steps(pageOf(world), given);
    auto* exception = scope.exception();
    if (!exception || !scope.tryClearException())
        return result;
    JSValue thrown = toWorld(world, exception->value());
    RETURN_IF_EXCEPTION(scope, {});
    throwException(world, scope, thrown);
    return {};
}

// `event.detail === event.detail`
static JSValue keptResult(World world, CallFrame* callFrame, JSValue result)
{
    VM& vm = world.vm();
    auto* alias = dynamicDowncast<Alias>(callFrame->thisValue());
    if (!alias || !result || !result.isObject() || isInterfaceCell(asObject(result)))
        return result;
    JSValue byGetter = alias->getDirect(vm, structureName(vm));
    if (!byGetter) {
        byGetter = JSWeakMap::create(vm, world.global()->weakMapStructure());
        alias->putDirect(vm, structureName(vm), byGetter);
    }
    JSValue kept = uncheckedDowncast<JSWeakMap>(byGetter)->get(callFrame->jsCallee());
    if (kept.isCell() && uncheckedDowncast<JSCellButterfly>(kept)->get(0) == result)
        return kept;
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue copy = Crossing(world, To::World).convert(result);
    RETURN_IF_EXCEPTION(scope, {});
    kept = createRecord(vm, { result, copy });
    uncheckedDowncast<JSWeakMap>(byGetter)->set(vm, callFrame->jsCallee(), kept);
    return kept;
}

static EncodedJSValue callAcross(World world, To to, CallFrame* callFrame, JSValue callee, JSValue receiver = {}, bool keepsResult = false, bool takesData = false)
{
    auto scope = DECLARE_THROW_SCOPE(world.vm());
    auto* realm = to == To::World ? world.global() : world.page();
    MarkedArgumentBuffer arguments;
    RELEASE_AND_RETURN(scope, Crossing(world, to == To::World ? To::Page : To::World).convertOutcome([&] {
        auto scope = DECLARE_THROW_SCOPE(world.vm());
        Crossing there(world, to);
        if (!receiver) {
            receiver = there.convertReceiver(callFrame->thisValue().toThis(realm, ECMAMode::strict()));
            RETURN_IF_EXCEPTION(scope, JSValue());
        }
        there.convertArguments(callFrame, arguments, takesData);
        RETURN_IF_EXCEPTION(scope, JSValue());
        JSValue result = call(realm, callee, receiver, arguments, "The value is not a function"_s);
        RETURN_IF_EXCEPTION(scope, JSValue());
        RELEASE_AND_RETURN(scope, keepsResult ? keptResult(world, callFrame, result) : result);
    }));
}

JSC_DEFINE_HOST_FUNCTION(callInPage, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* record = recordOfCallee(callFrame);
    return callAcross(World(globalObject), To::Page, callFrame, record->get(0), {}, record->get(1).isTrue(), record->get(2).isTrue());
}

JSC_DEFINE_HOST_FUNCTION(callInWorld, (JSGlobalObject*, CallFrame* callFrame))
{
    auto* record = recordOfCallee(callFrame);
    World world(uncheckedDowncast<JSGlobalObject>(record->get(0)));
    auto scope = DECLARE_THROW_SCOPE(world.vm());
    EncodedJSValue result = callAcross(world, To::World, callFrame, record->get(1));
    if (auto* exception = scope.exception()) [[unlikely]]
        world.page()->putDirect(world.vm(), thrownName(world.vm()), exception->value());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(getInWorld, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* record = recordOfCallee(callFrame);
    World world(uncheckedDowncast<JSGlobalObject>(record->get(0)));
    auto name = record->get(2).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    Crossing crossing(world, To::Page);
    RELEASE_AND_RETURN(scope, crossing.convertOutcome([&] {
        auto scope = DECLARE_THROW_SCOPE(world.vm());
        JSValue value = record->get(1).get(world.global(), name);
        RETURN_IF_EXCEPTION(scope, JSValue());
        RELEASE_AND_RETURN(scope, record->get(3).isTrue() ? crossing.convertData(value) : crossing.convert(value));
    }));
}

// Each world has its own event handlers. They are in `{ [name]: { value, listener } }`.
static JSObject* ownerOfHandlers(JSGlobalObject* world, CallFrame* callFrame)
{
    JSValue receiver = callFrame->thisValue().toThis(world, ECMAMode::strict());
    if (receiver.isUndefinedOrNull() || receiver == world->globalThis() || (receiver.inherits<Alias>() && recordOfCallee(callFrame)->get(1).isTrue()))
        return world;
    return dynamicDowncast<Alias>(receiver);
}

JSC_DEFINE_HOST_FUNCTION(getHandler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSObject* owner = ownerOfHandlers(globalObject, callFrame);
    if (!owner)
        return Bindgen::throwIllegalInvocation(globalObject);
    JSValue handlers = owner->getDirect(vm, handlersName(vm));
    JSValue handler = handlers ? asObject(handlers)->getDirect(vm, asString(recordOfCallee(callFrame)->get(0))->toIdentifier(globalObject)) : JSValue();
    return JSValue::encode(handler && handler.isObject() ? asObject(handler)->getDirect(vm, vm.propertyNames->value) : jsNull());
}

JSC_DEFINE_HOST_FUNCTION(setHandler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* owner = ownerOfHandlers(globalObject, callFrame);
    if (!owner)
        RELEASE_AND_RETURN(scope, Bindgen::throwIllegalInvocation(globalObject));
    JSValue handlers = owner->getDirect(vm, handlersName(vm));
    if (!handlers) {
        handlers = createHolder(globalObject);
        owner->putDirect(vm, handlersName(vm), handlers);
    }
    auto name = asString(recordOfCallee(callFrame)->get(0))->toIdentifier(globalObject);
    JSValue known = asObject(handlers)->getDirect(vm, name);
    JSObject* handler = known ? known.getObject() : nullptr;
    JSValue value = callFrame->argument(0);
    if (!handler && !value.isObject())
        return encodedJSUndefined();
    if (handler && value.isObject()) {
        handler->putDirect(vm, vm.propertyNames->value, value);
        return encodedJSUndefined();
    }
    if (handler)
        asObject(handlers)->putDirect(vm, name, jsUndefined());
    else {
        handler = constructEmptyObject(globalObject);
        handler->putDirect(vm, vm.propertyNames->value, value);
        handler->putDirect(vm, vm.propertyNames->target, World(globalObject).createFunction(globalObject, 1, emptyString(), runHandler, { handler, jsBoolean(owner == globalObject && name == "onerror"_s), jsBoolean(name == "onbeforeunload"_s) }));
        asObject(handlers)->putDirect(vm, name, handler);
    }
    String type = name.string().string().substring(2);
    for (ASCIILiteral prefixed : { "webkitAnimationEnd"_s, "webkitAnimationIteration"_s, "webkitAnimationStart"_s, "webkitTransitionEnd"_s }) {
        if (equalIgnoringASCIICase(type, prefixed))
            type = prefixed;
    }
    JSObject* receiver = owner == globalObject ? globalObject->globalThis() : owner;
    auto invoke = [&](ASCIILiteral method, const ArgList& arguments) {
        JSValue function = receiver->get(globalObject, Identifier::fromString(vm, method));
        RETURN_IF_EXCEPTION(scope, );
        if (function.isCallable())
            call(globalObject, function, getCallData(function), receiver, arguments);
    };
    MarkedArgumentBuffer arguments;
    arguments.append(jsString(vm, type));
    arguments.append(handler->getDirect(vm, vm.propertyNames->target));
    invoke(value.isObject() ? "addEventListener"_s : "removeEventListener"_s, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    if (value.isObject() && name == "onmessage"_s && owner != globalObject)
        invoke("start"_s, ArgList());
    RETURN_IF_EXCEPTION(scope, {});
    return encodedJSUndefined();
}

// https://html.spec.whatwg.org/#the-event-handler-processing-algorithm
JSC_DEFINE_HOST_FUNCTION(runHandler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* record = recordOfCallee(callFrame);
    JSValue handler = asObject(record->get(0))->getDirect(vm, vm.propertyNames->value);
    JSValue event = callFrame->argument(0);
    if (!handler.isCallable())
        return encodedJSUndefined();
    auto* alias = dynamicDowncast<Alias>(event);
    bool isError = record->get(1).isTrue() && alias && alias->target()->classInfo()->className == "ErrorEvent"_s;
    MarkedArgumentBuffer arguments;
    if (isError) {
        for (ASCIILiteral name : { "message"_s, "filename"_s, "lineno"_s, "colno"_s, "error"_s }) {
            arguments.append(event.get(globalObject, Identifier::fromString(vm, name)));
            RETURN_IF_EXCEPTION(scope, {});
        }
    } else
        arguments.append(event);
    JSValue result = call(globalObject, handler, getCallData(handler), callFrame->thisValue(), arguments);
    RETURN_IF_EXCEPTION(scope, {});
    bool cancels = isError ? result.isTrue() : record->get(2).isTrue() ? !result.isUndefinedOrNull()
                                                                       : result.isFalse();
    if (!cancels)
        return encodedJSUndefined();
    JSValue cancel = event.get(globalObject, Identifier::fromString(vm, "preventDefault"_s));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(call(globalObject, cancel, event, ArgList(), "preventDefault is not a function"_s)));
}

JSC_DEFINE_HOST_FUNCTION(callMethodInWorld, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* record = recordOfCallee(callFrame);
    World world(uncheckedDowncast<JSGlobalObject>(record->get(0)));
    JSValue method;
    Crossing(world, To::Page).convertOutcome([&] {
        method = record->get(1).get(world.global(), asString(record->get(2))->toIdentifier(world.global()));
        return jsUndefined();
    });
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, callAcross(world, To::World, callFrame, method, record->get(1)));
}

JSC_DEFINE_HOST_FUNCTION(constructInPage, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    World world(globalObject);
    JSValue prototype;
    if (callFrame->newTarget() != callFrame->jsCallee()) {
        prototype = callFrame->newTarget().get(globalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, {});
    }
    MarkedArgumentBuffer arguments;
    Crossing(world, To::Page).convertArgumentsOfConstructor(callFrame, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue made = JSValue::decode(Crossing(world, To::World).convertOutcome([&] {
        return JSValue(construct(world.page(), recordOfCallee(callFrame)->get(0), arguments, "Illegal constructor"_s));
    }));
    RETURN_IF_EXCEPTION(scope, {});
    if (!made.isObject())
        return throwVMTypeError(globalObject, scope, "Illegal constructor"_s);
    if (prototype && prototype.isObject())
        asObject(made)->setPrototypeDirect(vm, prototype);
    return JSValue::encode(made);
}

static EncodedJSValue accessInPage(JSGlobalObject* globalObject, CallFrame* callFrame, bool isSetter)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    World world(globalObject);
    auto* record = recordOfCallee(callFrame);
    auto* accessor = uncheckedDowncast<CustomGetterSetter>(record->get(0));
    auto name = record->get(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    Crossing toPage(world, To::Page);
    JSValue given = callFrame->thisValue().toThis(globalObject, ECMAMode::strict());
    JSValue receiver = given.isObject() ? toPage.counterpartOf(asObject(given)) : given.isUndefinedOrNull() ? world.page()->globalThis()
                                                                                                            : nullptr;
    auto* attribute = dynamicDowncast<DOMAttributeGetterSetter>(accessor);
    if (!receiver || (attribute && !receiver.inherits(attribute->domAttribute().classInfo)))
        RELEASE_AND_RETURN(scope, Bindgen::throwIllegalInvocation(globalObject));
    JSObject* window = asWindow(asObject(receiver));
    JSGlobalObject* realm = window ? window->realm() : world.page();
    JSValue value = isSetter ? toPage.convert(callFrame->argument(0)) : jsUndefined();
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, Crossing(world, To::World).convertOutcome([&] {
        auto scope = DECLARE_THROW_SCOPE(world.vm());
        if (!isSetter) {
            JSValue result = JSValue::decode(accessor->getter()(realm, JSValue::encode(receiver), name));
            RETURN_IF_EXCEPTION(scope, JSValue());
            RELEASE_AND_RETURN(scope, keptResult(world, callFrame, result));
        }
        Bindgen::Replacement replacement(name);
        accessor->setter()(realm, JSValue::encode(receiver), JSValue::encode(value), name);
        RETURN_IF_EXCEPTION(scope, JSValue());
        scope.release();
        if (replacement.wasAskedFor())
            (given.isObject() ? asObject(given) : globalObject->globalThis())->createDataProperty(globalObject, name, callFrame->argument(0), true);
        return jsUndefined();
    }));
}

JSC_DEFINE_HOST_FUNCTION(getInPage, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return accessInPage(globalObject, callFrame, false);
}

JSC_DEFINE_HOST_FUNCTION(setInPage, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return accessInPage(globalObject, callFrame, true);
}

bool is(JSGlobalObject* globalObject) { return recordOf(globalObject->vm(), globalObject); }

JSObject* targetOf(JSObject* object)
{
    auto* alias = dynamicDowncast<Alias>(object);
    return alias ? alias->target() : nullptr;
}

bool isShared(JSObject* object)
{
    return targetOf(object) || (isInterfaceCell(object) && isDesktopRealm(object->realm()) && !is(object->realm())) || asGlobalObject(object) || asWindow(object) || object->inherits<Bindgen::Generated::JSBlob>() || object->inherits<WebCore::JSAbortSignal>();
}

WebGlobalObject* pageOf(JSGlobalObject* world) { return is(world) ? uncheckedDowncast<WebGlobalObject>(World(world).page()) : nullptr; }
JSObject* deletedGlobalsOf(JSGlobalObject* world) { return World(world).deletedGlobals(); }
JSValue toWorld(JSGlobalObject* world, JSValue value) { return Crossing(World(world), To::World).convert(value); }
JSValue toPage(JSGlobalObject* world, JSValue value) { return Crossing(World(world), To::Page).convert(value); }

JSValue frameAt(JSGlobalObject* world, unsigned index)
{
    auto* page = pageOf(world);
    if (!page)
        return {};
    PropertySlot slot(page, PropertySlot::InternalMethodType::GetOwnProperty);
    JSValue frame = WebGlobalObject::getOwnPropertySlotByIndex(page, world, index, slot) ? slot.getValue(world, index) : jsUndefined();
    return frame.isObject() && asObject(frame)->type() == GlobalProxyType ? toWorld(world, frame) : JSValue();
}

void defineGlobal(JSGlobalObject* world, PropertyName name, const HashTableValue& row)
{
    VM& vm = world->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [member, attributes] = World(world).memberOfWindow(pageOf(world), name, row);
    RETURN_IF_EXCEPTION(scope, );
    AllowLazyMaterializationOfImmutableProperties allowMaterialization(vm);
    if (attributes & PropertyAttribute::Accessor)
        world->putDirectAccessor(world, name, uncheckedDowncast<GetterSetter>(member), attributes);
    else
        world->putDirect(vm, name, member, attributes);
}

}

namespace Bun {

using namespace JSC;

extern "C" bool Bun__IsolatedWorld__isShared(EncodedJSValue object) { return IsolatedWorld::isShared(asObject(JSValue::decode(object))); }

extern "C" JSGlobalObject* Bun__IsolatedWorld__pageOrItself(JSGlobalObject* realm)
{
    JSGlobalObject* page = IsolatedWorld::pageOf(realm);
    return page ? page : realm;
}

// Whether it is what a function of a world has thrown last. It is asked once.
extern "C" bool Bun__IsolatedWorld__hasThrown(JSGlobalObject* page, EncodedJSValue value)
{
    VM& vm = page->vm();
    auto& name = IsolatedWorld::thrownName(vm);
    if (page->getDirect(vm, name) != JSValue::decode(value))
        return false;
    page->putDirect(vm, name, page);
    return true;
}

extern "C" EncodedJSValue Bun__IsolatedWorld__carry(JSGlobalObject* from, JSGlobalObject* to, EncodedJSValue object)
{
    auto scope = DECLARE_THROW_SCOPE(from->vm());
    JSValue ofPage = IsolatedWorld::is(from) ? IsolatedWorld::toPage(from, JSValue::decode(object)) : JSValue::decode(object);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(IsolatedWorld::is(to) ? IsolatedWorld::toWorld(to, ofPage) : ofPage));
}

}
