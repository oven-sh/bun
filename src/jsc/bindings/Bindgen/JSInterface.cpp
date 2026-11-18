#include "root.h"
#include "Bindgen/JSInterface.h"
#include "Bindgen/InterfaceLookup.h"
#include "Bindgen/JSGlobalStandIn.h"
#include "Bindgen/SharedBodies.h"
#include "GeneratedBindings+InterfaceInfos.h"
#include "JSAbortSignal.h"
#include "JSAbortController.h"
#include "JSEventTarget.h"
#include "RemovableFeatures.h"
#include "WebGlobalObject.h"
#include "webcore/streams/JSWritableStream.h"
#include <JavaScriptCore/AsyncIteratorPrototype.h>
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/DOMAttributeGetterSetter.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/ErrorHandlingScope.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCellButterfly.h>
#include <JavaScriptCore/JSGlobalProxyInlines.h>
#include <JavaScriptCore/JSIteratorPrototype.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun::Bindgen {
using namespace JSC;

static_assert(sizeof(JSInterfaceObject<0>) == 24 && sizeof(JSInterfaceObject<2>) == 40);

const ClassInfo JSInterfaceObject<2>::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSInterfaceObject<2>) };

static ALWAYS_INLINE size_t numberOfInterface(const ClassInfo* info)
{
    return std::bit_cast<const InterfaceInfo*>(info) - Generated::InterfaceInfos::all;
}

static ALWAYS_INLINE void forEachRunOfFields(JSCell* cell, const ClassInfo* info, auto&& callback)
{
    for (auto* run = &Generated::interfaceFields[numberOfInterface(info)]; run->count; run = &Generated::interfaceFields[run->next]) {
        callback(std::span { std::bit_cast<WriteBarrier<Unknown>*>(std::bit_cast<char*>(cell) + run->offset), run->count }, run->names);
        if (run->next < 0)
            break;
    }
}

// Hidden: `analyzeHeap` reports them by name.
static ALWAYS_INLINE void visitFields(JSCell* cell, const ClassInfo* info, auto& visitor)
{
    forEachRunOfFields(cell, info, [&](auto fields, unsigned) { visitor.appendValuesHidden(fields.data(), fields.size()); });
}

static void analyzeFields(JSCell* cell, const ClassInfo* info, HeapAnalyzer& analyzer)
{
    forEachRunOfFields(cell, info, [&](auto fields, unsigned names) {
        auto rest = byteCast<Latin1Character>(std::span { Generated::interfaceFieldNames }.subspan(names));
        for (auto& field : fields) {
            size_t length = WTF::find(rest, ' ');
            if (JSValue value = field.get(); value && value.isCell())
                analyzer.analyzePropertyNameEdge(cell, value.asCell(), Identifier::fromString(cell->vm(), rest.first(length)).impl());
            rest = rest.subspan(length + 1);
        }
    });
}

template<typename Visitor>
void JSInterfaceObject<0>::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = static_cast<JSInterfaceObject<0>*>(cell);
    Base::visitChildren(thisObject, visitor);
    visitFields(cell, thisObject->interfaceInfo(), visitor);
}
DEFINE_VISIT_CHILDREN(JSInterfaceObject<0>);

void JSInterfaceObject<0>::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    Base::analyzeHeap(cell, analyzer);
    analyzeFields(cell, static_cast<JSInterfaceObject<0>*>(cell)->interfaceInfo(), analyzer);
}

template<typename Visitor>
void JSInterfaceObject<2>::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = static_cast<JSInterfaceObject<2>*>(cell);
    Base::visitChildren(thisObject, visitor);
    visitor.appendValuesHidden(thisObject->m_inlineStorage, inlineCapacity);
    visitFields(cell, thisObject->interfaceInfo(), visitor);
}
DEFINE_VISIT_CHILDREN(JSInterfaceObject<2>);

void JSInterfaceObject<2>::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    Base::analyzeHeap(cell, analyzer);
    analyzeFields(cell, static_cast<JSInterfaceObject<2>*>(cell)->interfaceInfo(), analyzer);
}

template<typename Visitor>
void JSInterfaceList::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Base::visitChildren(cell, visitor);
    static_cast<JSInterfaceList*>(cell)->m_items.visit(visitor);
}
DEFINE_VISIT_CHILDREN(JSInterfaceList);

// For `bindgen::PublishesItems`.
static_assert(sizeof(JSInterfaceList) == 48 && EmbedderListType == 0xE2);
static_assert(EmbedderListItems::offsetOfItems() == 24 && EmbedderListItems::offsetOfTime() == 32 && EmbedderListItems::offsetOfClock() == 40);

extern "C" void Bun__Bindgen__publishItems(JSCell* list, const uintptr_t* addresses, uint32_t count, uintptr_t offsetInCell, const uint64_t* clock)
{
    VM& vm = list->vm();
    DeferGCForAWhile deferGC(vm);
    auto* items = JSCellButterfly::tryCreate(vm, vm.cellButterflyStructure(CopyOnWriteArrayWithContiguous), count);
    if (!items)
        return;
    auto* values = items->toButterfly()->contiguous().data();
    for (uint32_t i = 0; i < count; i++)
        values[i].setWithoutWriteBarrier(JSValue::decode(addresses[i] - offsetInCell));
    vm.mutatorFence();
    EmbedderListItems::of(list).publish(vm, list, items, clock);
}

template<typename Base>
struct AnyInterfaceObject : Base {
    AnyInterfaceObject(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
        forEachRunOfFields(this, this->interfaceInfo(), [](auto fields, unsigned) {
            for (auto& field : fields)
                field.clear();
        });
    }
};

JSObject* createInterfaceObjectOutOfLine(Zig::GlobalObject* globalObject, unsigned number, Structure* structure, size_t cellSize, bool needsDestruction)
{
    VM& vm = getVM(globalObject);
    if (!structure)
        structure = lazyInterface(globalObject, number).get(globalObject);
    bool hasInlineStorage = structure->typeInfo().type() == JSInterfaceObject<2>::cellType;
    auto* cell = allocateInterfaceCell(vm, structure->classInfoForCells(), cellSize, needsDestruction, hasInlineStorage);
    auto finish = [&](auto* object) -> JSObject* {
        object->finishCreation(vm);
        return object;
    };
    if (structure->typeInfo().type() == JSInterfaceList::cellType)
        return finish(new (NotNull, cell) AnyInterfaceObject<JSInterfaceList>(vm, structure));
    return hasInlineStorage ? finish(new (NotNull, cell) AnyInterfaceObject<JSInterfaceObject<2>>(vm, structure)) : finish(new (NotNull, cell) AnyInterfaceObject<JSInterfaceObject<0>>(vm, structure));
}

void destroyInterfaceWithInlineStorage(JSCell* cell)
{
    static_cast<JSInterfaceObject<2>*>(cell)->interfaceInfo()->methodTable.destroy(cell);
}

NEVER_INLINE GCClient::IsoSubspace* createSubspaceForInterface(VM& vm, unsigned index)
{
    using CellType = WebCore::SubspaceForInit::CellType;
    static constexpr CellType cellTypes[] = { CellType::Cell, CellType::Destructible, CellType::Custom };
    unsigned cellSize = (index % WebCore::numberOfInterfaceCellSizes + 1) * MarkedBlock::atomSize;
    return WebCore::subspaceForImplSlow(
        vm,
        WebCore::SubspaceForInit { cellSize, JSDestructibleObject::numberOfLowerTierPreciseCells, cellTypes[index / WebCore::numberOfInterfaceCellSizes], false },
        WebCore::SubspaceSlots {
            OBJECT_OFFSETOF(WebCore::ExtendedDOMClientIsoSubspaces, m_clientSubspaceForInterface) + index * sizeof(GCClient::IsoSubspace*),
            OBJECT_OFFSETOF(WebCore::ExtendedDOMIsoSubspaces, m_subspaceForInterface) + index * sizeof(IsoSubspace*),
        },
        WebCore::customHeapCellType<InterfaceWithInlineStorageCellType>);
}

// What the prototypes of an interface have in common in all realms: a structure, the exposure, then the values in the order of their offsets, with executables for functions.
struct Patterns {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(Patterns);
    static constexpr unsigned structure = 0, exposure = 1, firstValue = 2;
    // For contexts that are not secure, and for those that are.
    std::array<WriteBarrier<JSCellButterfly>, 2 * Generated::numberOfInterfaces> all;
};

struct Interfaces {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(Interfaces);
    std::array<LazyClassStructure, Generated::numberOfInterfaces> classes;
    // Each has the properties that an instance gets as its own.
    std::array<WriteBarrier<JSObject>, Generated::numberOfClassesWithUnforgeables> unforgeables;
    // The first values of those, which hold them.
    JSValue inlineUnforgeables[Generated::numberOfClassesWithUnforgeables + 1][2];
    WriteBarrier<Structure> observableArrayStructure;
    std::array<WriteBarrier<JSObject>, Generated::numberOfInterfaces> instancesOfRealm;
    // In the first realm, for the others.
    WTF::BitSet<Generated::numberOfInterfaces> wereSetUp;
    std::unique_ptr<Patterns> patterns;
};
static_assert(!OBJECT_OFFSETOF(Interfaces, classes));

static Interfaces* interfacesOf(const AdditionsToGlobalObject& additions) { return reinterpret_cast<Interfaces*>(additions.m_interfaces); }

NEVER_INLINE LazyClassStructure* createInterfaces(Zig::GlobalObject* globalObject)
{
    auto* interfaces = new Interfaces;
    for (auto& lazyClass : interfaces->classes) {
        lazyClass.initLater([](LazyClassStructure::Initializer& init) {
            auto* classes = uncheckedDowncast<Zig::GlobalObject>(init.global)->m_bindgenAdditions.m_interfaces;
            Generated::setupInterfaceStructure[&init.classStructure - classes](init);
        });
    }
    globalObject->m_bindgenAdditions.m_inlineUnforgeables = interfaces->inlineUnforgeables;
    WTF::storeStoreFence();
    return globalObject->m_bindgenAdditions.m_interfaces = reinterpret_cast<LazyClassStructure*>(interfaces);
}

AdditionsToGlobalObject::~AdditionsToGlobalObject()
{
    delete interfacesOf(*this);
}

template<typename Visitor>
void AdditionsToGlobalObject::visitInterfaces(Visitor& visitor)
{
    auto* interfaces = interfacesOf(*this);
    for (auto& lazyClass : interfaces->classes)
        lazyClass.visit(visitor);
    for (auto& holder : interfaces->unforgeables)
        visitor.append(holder);
    visitor.append(interfaces->observableArrayStructure);
    visitor.append(interfaces->instancesOfRealm.begin(), interfaces->instancesOfRealm.end());
    if (auto* patterns = interfaces->patterns.get())
        visitor.append(patterns->all.begin(), patterns->all.end());
}
template void AdditionsToGlobalObject::visitInterfaces(AbstractSlotVisitor&);
template void AdditionsToGlobalObject::visitInterfaces(SlotVisitor&);

Structure* structureForInterface(JSGlobalObject* globalObject, unsigned number)
{
    auto* global = defaultGlobalObject(globalObject);
    return lazyInterface(global, number).get(global);
}

JSObject* prototypeForInterface(JSGlobalObject* globalObject, unsigned number)
{
    auto* global = defaultGlobalObject(globalObject);
    return lazyInterface(global, number).prototype(global);
}

JSObject* constructorForInterface(JSGlobalObject* globalObject, unsigned number)
{
    auto* global = defaultGlobalObject(globalObject);
    return lazyInterface(global, number).constructor(global);
}

static std::optional<unsigned> findInterface(JSGlobalObject* globalObject, NOESCAPE const auto& matches)
{
    auto* global = dynamicDowncast<Zig::GlobalObject>(globalObject);
    auto* classes = global ? global->m_bindgenAdditions.m_interfaces : nullptr;
    for (unsigned number = 0; classes && number < Generated::numberOfInterfaces; ++number) {
        if (matches(classes[number]))
            return number;
    }
    return std::nullopt;
}

std::optional<unsigned> interfaceWithPrototype(JSGlobalObject* globalObject, JSObject* prototype)
{
    return findInterface(globalObject, [&](auto& it) { return it.getConcurrently() && it.getConcurrently()->storedPrototype() == prototype; });
}

std::optional<unsigned> interfaceWithConstructor(JSGlobalObject* globalObject, JSObject* constructor)
{
    return findInterface(globalObject, [&](auto& it) { return it.constructorConcurrently() == constructor; });
}

unsigned interfaceOf(JSObject* cell)
{
    return reinterpret_cast<const InterfaceInfo*>(cell->classInfo()) - Generated::InterfaceInfos::all;
}

static JSObject* instanceOfRealm(JSGlobalObject* globalObject, unsigned number)
{
    auto* interfaces = interfacesOf(uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_bindgenAdditions);
    return interfaces ? interfaces->instancesOfRealm[number].get() : nullptr;
}

static void setInstanceOfRealm(JSGlobalObject* globalObject, unsigned number, JSObject* instance)
{
    structureForInterface(globalObject, number);
    interfacesOf(uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_bindgenAdditions)->instancesOfRealm[number].set(globalObject->vm(), globalObject, instance);
}

JSValue interfaceObjectNamed(JSGlobalObject* globalObject, const StringImpl& name)
{
    auto& all = Generated::interfaceObjectsByName;
    auto found = std::ranges::lower_bound(all, StringView(name), codePointCompareLessThan, [](auto& it) { return StringView(it.name); });
    if (found == all.end() || StringView(found->name) != StringView(name))
        return jsUndefined();
    return found->createFactory ? found->createFactory(globalObject->vm(), globalObject) : constructorForInterface(globalObject, found->number);
}

Structure* interfaceStructureForNewTarget(JSGlobalObject* globalObject, JSValue newTargetValue, unsigned number)
{
    JSObject* newTarget = asObject(newTargetValue);
    // That of the constructor.
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto& lazyClass = lazyInterface(global, number);
    if (newTarget == lazyClass.constructorConcurrently()) [[likely]]
        return lazyClass.get(global);
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* realm = getFunctionRealm(globalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, InternalFunction::createSubclassStructure(globalObject, newTarget, structureForInterface(realm, number)));
}

static void forEachName(VM& vm, ASCIILiteral names, NOESCAPE const auto& callback)
{
    for (StringView name : StringView(names).split(' ')) {
        if (name.startsWith("@@"_s))
            callback(Identifier::fromUid(*vm.propertyNames->builtinNames().lookUpWellKnownSymbol(name.substring(2).span8())));
        else
            callback(Identifier::fromString(vm, name.span8()));
    }
}

static void copyProperty(VM& vm, JSGlobalObject* globalObject, JSObject* from, JSObject* to, const Identifier& name, JSValue value, unsigned attributes)
{
    UNUSED_PARAM(from);
    if (attributes & PropertyAttribute::Accessor)
        to->putDirectAccessor(globalObject, name, uncheckedDowncast<GetterSetter>(value), attributes);
    else if (attributes & PropertyAttribute::CustomAccessorOrValue)
        to->putDirectCustomAccessor(vm, name, value, attributes);
    else
        to->putDirect(vm, name, value, attributes);
}

EncodedJSValue constructWithFactory(JSGlobalObject* globalObject, CallFrame* callFrame, NativeFunction factory)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue newTarget = callFrame->newTarget();
    JSValue made = JSValue::decode(factory(globalObject, callFrame));
    RETURN_IF_EXCEPTION(scope, {});
    if (newTarget == callFrame->jsCallee())
        return JSValue::encode(made);
    JSValue prototype = newTarget.get(globalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, {});
    if (prototype.isObject())
        asObject(made)->setPrototypeDirect(vm, prototype);
    return JSValue::encode(made);
}

JSValue behindInstance(JSGlobalObject* globalObject, JSValue value)
{
    VM& vm = getVM(globalObject);
    JSValue behind = value.isObject() ? asObject(value)->getDirect(vm, WebCore::builtinNames(vm).implPrivateName()) : JSValue();
    return behind ? behind : jsUndefined();
}

class InterfaceText {
public:
    using Table = Vector<HashTableValue>;

    InterfaceText(const InterfaceDescription& description, bool withPrototype)
        : m_text(description.text)
        , m_entries(description.entries)
        , prototypeTable(table(withPrototype))
        , conditionalTables(description.numberOfConditions, [&](size_t i) { return table(withPrototype || description.conditions[i].isStatic); })
    {
    }

private:
    ASCIILiteral literal()
    {
        auto result = ASCIILiteral::fromLiteralUnsafe(m_text);
        m_text += result.length() + 1;
        return result;
    }

    Table table(bool isNeeded = true)
    {
        Table result;
        while (uint8_t row = *m_text++) {
            unsigned attributes = 0;
            auto add = [&](uint8_t flag, PropertyAttribute attribute) { attributes |= row & flag ? static_cast<unsigned>(attribute) : 0; };
            add(MemberRow::DontEnum, PropertyAttribute::DontEnum);
            add(MemberRow::DontDelete, PropertyAttribute::DontDelete);
            add(MemberRow::ReadOnly, PropertyAttribute::ReadOnly);
            add(MemberRow::DOMAttribute, PropertyAttribute::DOMAttribute);
            auto append = [&](PropertyAttribute kind, HashTableValue::ValueStorage value) {
                auto name = literal();
                if (isNeeded)
                    result.append({ name, attributes | kind, NoIntrinsic, value });
            };
            auto& entry = *m_entries++;
            switch (row & MemberRow::KindMask) {
            case MemberRow::Function:
                append(PropertyAttribute::Function, { HashTableValue::NativeFunctionType, entry.function, *m_text++ });
                break;
            case MemberRow::Builtin:
                append(PropertyAttribute::Builtin, { HashTableValue::BuiltinGeneratorType, entry.generator, *m_text++ });
                break;
            case MemberRow::Constant:
                append(PropertyAttribute::ConstantInteger, { HashTableValue::ConstantType, entry.constant });
                break;
            case MemberRow::Accessor:
                append(PropertyAttribute::CustomAccessor, { HashTableValue::GetterSetterType, entry.getter, row & MemberRow::ReadOnly ? nullptr : (m_entries++)->setter });
                break;
            case MemberRow::DOMJITAccessor: {
                auto setter = row & MemberRow::ReadOnly ? nullptr : (m_entries++)->setter;
                if (removedFeatureAt(std::bit_cast<const void*>(entry.domJIT->getter()))) [[unlikely]] {
                    append(PropertyAttribute::CustomAccessor, { HashTableValue::GetterSetterType, entry.domJIT->getter(), setter });
                    break;
                }
                attributes |= PropertyAttribute::DOMJITAttribute;
                append(PropertyAttribute::CustomAccessor, { HashTableValue::DOMJITAttributeType, entry.domJIT, setter });
                break;
            }
            case MemberRow::DOMJITFunction: {
                auto* signature = (m_entries++)->signature;
                if (removedFeatureAt(std::bit_cast<const void*>(entry.function))) [[unlikely]] {
                    append(PropertyAttribute::Function, { HashTableValue::NativeFunctionType, entry.function, static_cast<int>(signature->argumentCount) });
                    break;
                }
                attributes |= PropertyAttribute::DOMJITFunction;
                append(PropertyAttribute::Function, { HashTableValue::DOMJITFunctionType, entry.function, signature });
                break;
            }
            }
        }
        return result;
    }

    const char* m_text;
    const MemberEntry* m_entries;

public:
    // Names, separated by spaces. These are pairs: the new name, and the one that the function has.
    const ASCIILiteral sameFunctions { literal() };
    const ASCIILiteral unscopables { literal() };
    const Table prototypeTable;
    const Table constructorTable { table() };
    const Table unforgeableTable { table() };
    const Vector<Table> conditionalTables;
};

class HostFunction final : public JSFunction {
public:
    static JSFunction* create(VM& vm, JSGlobalObject* globalObject, NativeExecutable* executable)
    {
        auto* function = new (NotNull, allocateCell<JSFunction>(vm)) HostFunction(vm, executable, globalObject, globalObject->hostFunctionStructure());
        function->finishCreation(vm);
        return function;
    }

private:
    using JSFunction::JSFunction;
};
static_assert(sizeof(HostFunction) == sizeof(JSFunction));

static Structure* copyStructure(VM& vm, Structure* structure, JSGlobalObject* realm, JSValue prototype)
{
    ASSERT(structure->isDictionary());
    DeferredStructureTransitionWatchpointFire deferred(vm, structure);
    Structure* copy = Structure::changePrototypeTransition(vm, structure, prototype, deferred);
    copy->setRealm(vm, realm);
    return copy;
}

static JSObject* createFromPattern(VM& vm, JSGlobalObject* globalObject, JSCellButterfly* pattern, JSObject* base)
{
    DeferGC deferGC(vm);
    base->didBecomePrototype(vm);
    Structure* structure = copyStructure(vm, uncheckedDowncast<Structure>(pattern->get(Patterns::structure)), globalObject, base);
    unsigned capacity = structure->outOfLineCapacity();
    JSObject* prototype = JSFinalObject::createWithButterfly(vm, structure, capacity ? Butterfly::create(vm, nullptr, 0, capacity, false, IndexingHeader(), 0) : nullptr);
    for (unsigned i = Patterns::firstValue; i < pattern->length(); ++i) {
        JSValue value = pattern->get(i);
        if (auto* executable = dynamicDowncast<NativeExecutable>(value))
            value = HostFunction::create(vm, globalObject, executable);
        prototype->putDirectOffset(vm, offsetForPropertyNumber(i - Patterns::firstValue, structure->inlineCapacity()), value);
    }
    return prototype;
}

static JSCellButterfly* createPattern(VM& vm, JSGlobalObject* owner, JSObject* prototype, unsigned exposure)
{
    DeferGC deferGC(vm);
    Structure* structure = prototype->structure();
    unsigned count = numberOfSlotsForMaxOffset(structure->maxOffset(), structure->inlineCapacity());
    auto* pattern = JSCellButterfly::create(vm, CopyOnWriteArrayWithContiguous, Patterns::firstValue + count);
    for (unsigned i = 0; i < count; ++i) {
        JSValue value = prototype->getDirect(offsetForPropertyNumber(i, structure->inlineCapacity()));
        if (auto* function = dynamicDowncast<JSFunction>(value); function && function->isHostFunction())
            value = function->executable();
        else if (value.isObject())
            return nullptr;
        pattern->setIndex(vm, Patterns::firstValue + i, value);
    }
    Structure* copy = copyStructure(vm, structure, owner, jsNull());
    pattern->setIndex(vm, Patterns::structure, copy);
    // No inline cache can rely on a structure that another was made from.
    prototype->setStructure(vm, copyStructure(vm, copy, structure->realm(), structure->storedPrototype()));
    pattern->setIndex(vm, Patterns::exposure, jsNumber(exposure));
    return pattern;
}

// For the realms of the Web, from the second on that needs the interface.
static WriteBarrier<JSCellButterfly>* placeOfPattern(Zig::GlobalObject* owner, unsigned exposure, unsigned number)
{
    auto* interfaces = exposure == owner->m_bindgenAdditions.m_exposure ? nullptr : interfacesOf(owner->m_bindgenAdditions);
    if (!interfaces || !interfaces->wereSetUp.testAndSet(number))
        return nullptr;
    if (!interfaces->patterns) {
        auto patterns = makeUnique<Patterns>();
        WTF::storeStoreFence();
        interfaces->patterns = WTF::move(patterns);
    }
    auto& place = interfaces->patterns->all[2 * number + !!(exposure & Exposure::SecureContext)];
    return !place || place->get(Patterns::exposure) == jsNumber(exposure) ? &place : nullptr;
}

void setupInterface(LazyClassStructure::Initializer& init, const InterfaceDescription& description, NativeFunction call, NativeFunction construct, FinishPrototype finishPrototype)
{
    VM& vm = init.vm;
    const ClassInfo* info = &Generated::InterfaceInfos::all[description.number].info;
    JSGlobalObject* globalObject = init.global;
    auto* ownerOfPatterns = defaultGlobalObject(vm);
    unsigned realm = uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_bindgenAdditions.m_exposure;
    auto* place = placeOfPattern(ownerOfPatterns, realm, description.number);
    JSCellButterfly* pattern = place ? place->get() : nullptr;
    InterfaceText text(description, !pattern);
    JSObject* prototypeBase = nullptr;
    JSObject* constructorBase = nullptr;
    if (description.base >= 0) {
        prototypeBase = prototypeForInterface(globalObject, description.base);
        constructorBase = constructorForInterface(globalObject, description.base);
    } else if (description.prototypeBase == PrototypeBase::EventEmitter) {
        prototypeBase = eventEmitterPrototype(globalObject);
        constructorBase = eventEmitterConstructor(globalObject);
    } else if (description.prototypeBase == PrototypeBase::Readable || description.prototypeBase == PrototypeBase::Writable) {
        ErrorHandlingScope reservedStack(vm);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue constructor = requireNodeModule(defaultGlobalObject(globalObject), description.prototypeBase == PrototypeBase::Readable ? "readable"_s : "writable"_s);
        scope.releaseAssertNoExceptionExceptTermination();
        constructorBase = asObject(constructor);
        JSValue prototype = constructorBase->get(globalObject, vm.propertyNames->prototype);
        scope.releaseAssertNoExceptionExceptTermination();
        prototypeBase = prototype.isObject() ? asObject(prototype) : globalObject->objectPrototype();
    } else if (description.prototypeBase == PrototypeBase::DOMException) {
        static_assert(sizeof(WebCore::JSDOMException) == sizeof(JSInterfaceObject<0>) + sizeof(void*));
        prototypeBase = WebCore::JSDOMException::prototype(vm, *uncheckedDowncast<Zig::GlobalObject>(globalObject));
        constructorBase = asObject(WebCore::JSDOMException::getConstructor(vm, globalObject));
    } else if (description.prototypeBase == PrototypeBase::WritableStream) {
        prototypeBase = WebCore::JSWritableStream::prototype(vm, *defaultGlobalObject(globalObject));
        constructorBase = asObject(WebCore::JSWritableStream::getConstructor(vm, globalObject));
    } else if (description.prototypeBase == PrototypeBase::EventTarget) {
        prototypeBase = WebCore::JSEventTarget::prototype(vm, *defaultGlobalObject(globalObject));
        constructorBase = asObject(WebCore::JSEventTarget::getConstructor(vm, globalObject));
    } else if (description.prototypeBase == PrototypeBase::AbortController) {
        prototypeBase = WebCore::JSAbortController::prototype(vm, *defaultGlobalObject(globalObject));
        constructorBase = asObject(WebCore::JSAbortController::getConstructor(vm, globalObject));
    } else if (description.prototypeBase == PrototypeBase::AbortSignal) {
        prototypeBase = WebCore::JSAbortSignal::prototype(vm, *defaultGlobalObject(globalObject));
        constructorBase = asObject(WebCore::JSAbortSignal::getConstructor(vm, globalObject));
    } else if (description.prototypeBase == PrototypeBase::Error)
        prototypeBase = globalObject->errorPrototype();
    else if (description.prototypeBase == PrototypeBase::Iterator)
        prototypeBase = globalObject->iteratorPrototype();
    else if (description.prototypeBase == PrototypeBase::AsyncIterator)
        prototypeBase = globalObject->asyncIteratorPrototype();
    else
        prototypeBase = globalObject->objectPrototype();
    auto reifyWhatIsExposed = [&](JSObject& object, bool isStatic) {
        for (unsigned i = 0; i < description.numberOfConditions; ++i) {
            auto& condition = description.conditions[i];
            unsigned globals = condition.exposure & ~Exposure::SecureContext;
            if (condition.isStatic == isStatic && (!globals || (globals & realm)) && !(condition.exposure & ~realm & Exposure::SecureContext))
                Bun::reifyStaticPropertyTable(vm, info, text.conditionalTables[i].span(), object);
        }
    };

    JSObject* prototype;
    if (pattern)
        prototype = createFromPattern(vm, globalObject, pattern, prototypeBase);
    else {
        constexpr unsigned ordinary = JSFinalObject::StructureFlags;
        auto* prototypeStructure = Structure::create(vm, globalObject, prototypeBase, TypeInfo(FinalObjectType, description.isAboveGlobalObject ? ordinary | IsImmutablePrototypeExoticObject : ordinary), JSFinalObject::info());
        prototypeStructure->setMayBePrototype(true);
        prototype = JSFinalObject::create(vm, prototypeStructure);
        Bun::reifyStaticPropertyTable(vm, info, text.prototypeTable.span(), *prototype);
        reifyWhatIsExposed(*prototype, false);
        if (place)
            place->setMayBeNull(vm, ownerOfPatterns, createPattern(vm, ownerOfPatterns, prototype, realm));
    }
    if (description.arrayFunctions != ArrayFunctions::None)
        prototype->putDirect(vm, vm.propertyNames->iteratorSymbol, globalObject->arrayProtoValuesFunction(), static_cast<unsigned>(PropertyAttribute::DontEnum));
    if (description.arrayFunctions == ArrayFunctions::All) {
        auto& names = vm.propertyNames->builtinNames();
        auto copy = [&](const Identifier& from, const Identifier& to) { prototype->putDirect(vm, to, globalObject->arrayPrototype()->getDirect(vm, from)); };
        copy(names.entriesPrivateName(), names.entriesPublicName());
        copy(names.forEachPrivateName(), names.forEachPublicName());
        copy(names.keysPrivateName(), names.keysPublicName());
        copy(names.valuesPrivateName(), names.valuesPublicName());
    }
    Identifier newName;
    forEachName(vm, text.sameFunctions, [&](const Identifier& name) {
        if (newName.isNull()) {
            newName = name;
            return;
        }
        if (JSValue function = prototype->getDirect(vm, name))
            prototype->putDirect(vm, newName, function, newName.isSymbol() ? static_cast<unsigned>(PropertyAttribute::DontEnum) : 0);
        newName = {};
    });
    if (finishPrototype)
        finishPrototype(vm, globalObject, prototype);
    if (!text.unscopables.isEmpty()) {
        JSObject* unscopables = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        forEachName(vm, text.unscopables, [&](const Identifier& name) { unscopables->putDirect(vm, name, jsBoolean(true)); });
        prototype->putDirect(vm, vm.propertyNames->unscopablesSymbol, unscopables, PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
    }
    Bun::putToStringTagWithoutTransition(vm, prototype, info);
    auto* interfaces = interfacesOf(uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_bindgenAdditions);
    if (description.unforgeablesIndex >= 0) {
        JSObject* holder = createClassPrototype(vm, globalObject, globalObject->objectPrototype(), info, text.unforgeableTable.span());
        interfaces->unforgeables[description.unforgeablesIndex].set(vm, globalObject, holder);
        unsigned slot = 0;
        holder->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
            interfaces->inlineUnforgeables[description.unforgeablesIndex][slot] = holder->getDirect(entry.offset());
            return ++slot < 2;
        });
    }

    JSObject* constructor = nullptr;
    if (description.hasConstructor) {
        if (description.isNamespace) {
            // https://console.spec.whatwg.org/#console-namespace
            if (info->className == "console"_s)
                prototypeBase = constructEmptyObject(globalObject);
            constructor = createClassPrototype(vm, globalObject, prototypeBase, info, text.constructorTable.span());
            Bun::putToStringTagWithoutTransition(vm, constructor, info);
        } else if (description.isCallbackInterface) {
            constructor = JSFunction::create(vm, globalObject, 0, info->className, constructInterfaceObject, ImplementationVisibility::Public);
            Bun::reifyStaticPropertyTable(vm, info, text.constructorTable.span(), *constructor);
        } else
            constructor = JSClassConstructor::create(vm, globalObject, info->className, call, construct, description.length, text.constructorTable.span(), prototype, constructorBase);
        reifyWhatIsExposed(*constructor, true);
    }
    if (description.structureFlags & MasqueradesAsUndefined)
        globalObject->masqueradesAsUndefinedWatchpointSet().fireAll(vm, "Created an interface whose instances masquerade as undefined");
    init.setPrototype(prototype);
    Structure* structure = Structure::create(vm, globalObject, prototype, TypeInfo(description.cellType, description.structureFlags), info, description.hasIndexedProperties ? MayHaveIndexedAccessors : NonArray, description.inlineCapacity);
    for (int16_t index : description.inlineUnforgeables) {
        if (index < 0)
            break;
        interfaces->unforgeables[index]->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
            PropertyOffset offset;
            structure = Structure::addPropertyTransition(vm, structure, entry.key(), entry.attributes(), offset);
            if (entry.attributes() & PropertyAttribute::ReadOnly)
                structure->setContainsReadOnlyProperties();
            if (entry.attributes() & PropertyAttribute::CustomAccessor)
                structure->setHasAnyKindOfGetterSetterPropertiesWithProtoCheck(false);
            return true;
        });
    }
    init.setStructure(structure);
    if (constructor)
        init.setConstructor(constructor);
}

void putPrivateAttribute(VM& vm, JSObject* object, PropertyName name, const ClassInfo* receiver, GetValueFunc getter, PutValueFunc setter)
{
    unsigned attributes = PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete;
    if (!setter)
        attributes |= PropertyAttribute::ReadOnly;
    if (receiver)
        object->putDirectCustomAccessor(vm, name, DOMAttributeGetterSetter::create(vm, getter, setter, DOMAttributeAnnotation { receiver, nullptr }), attributes);
    else
        object->putDirectCustomAccessor(vm, name, CustomGetterSetter::create(vm, getter, setter), attributes);
}

void putAttributesByName(VM& vm, JSObject* prototype, const ClassInfo* receiver, void(SYSV_ABI* collectNames)(Vector<AtomString>*), GetValueFunc getter, PutValueFunc setter)
{
    Vector<AtomString> names;
    collectNames(&names);
    auto* accessor = DOMAttributeGetterSetter::create(vm, getter, setter, DOMAttributeAnnotation { receiver, nullptr });
    unsigned attributes = PropertyAttribute::CustomAccessor | PropertyAttribute::DOMAttribute;
    if (!setter)
        attributes |= PropertyAttribute::ReadOnly;
    prototype->convertToDictionary(vm);
    for (auto& name : names)
        prototype->putDirectCustomAccessor(vm, Identifier::fromString(vm, name), accessor, attributesForStructure(attributes));
}

EncodedJSValue defaultToJSON(JSGlobalObject* globalObject, JSObject* object, std::span<const JSONAttribute> attributes)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* result = constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min<unsigned>(attributes.size(), JSFinalObject::maxInlineCapacity));
    for (auto& attribute : attributes) {
        auto name = Identifier::fromString(vm, attribute.name);
        JSValue value = JSValue::decode(attribute.get(globalObject, JSValue::encode(object), name));
        RETURN_IF_EXCEPTION(scope, {});
        result->putDirect(vm, name, value);
    }
    return JSValue::encode(result);
}

template<typename Entries> constexpr bool isMap = std::is_same_v<Entries, JSMap>;

template<typename Entries> Entries* backing(JSObject* owner, WriteBarrier<Unknown>& field)
{
    if (JSValue entries = field.get())
        return uncheckedDowncast<Entries>(entries);
    VM& vm = owner->vm();
    auto* entries = Entries::create(vm, isMap<Entries> ? owner->globalObject()->mapStructure() : owner->globalObject()->setStructure());
    field.set(vm, owner, entries);
    return entries;
}
template JSMap* backing(JSObject*, WriteBarrier<Unknown>&);
template JSSet* backing(JSObject*, WriteBarrier<Unknown>&);

namespace Collection {

static JSMapIterator* iterate(JSGlobalObject* globalObject, JSMap* map, IterationKind kind) { return JSMapIterator::create(getVM(globalObject), globalObject->mapIteratorStructure(), map, kind); }
static JSSetIterator* iterate(JSGlobalObject* globalObject, JSSet* set, IterationKind kind) { return JSSetIterator::create(getVM(globalObject), globalObject->setIteratorStructure(), set, kind); }

template<typename Entries> EncodedJSValue entries(JSGlobalObject* globalObject, CallFrame*, Entries* backing) { return JSValue::encode(iterate(globalObject, backing, IterationKind::Entries)); }
template<typename Entries> EncodedJSValue values(JSGlobalObject* globalObject, CallFrame*, Entries* backing) { return JSValue::encode(iterate(globalObject, backing, IterationKind::Values)); }
EncodedJSValue keys(JSGlobalObject* globalObject, CallFrame*, JSMap* backing) { return JSValue::encode(iterate(globalObject, backing, IterationKind::Keys)); }

template<typename Entries> EncodedJSValue forEach(JSGlobalObject* globalObject, CallFrame* callFrame, Entries* backing)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue callback = callFrame->argument(0);
    auto callData = getCallData(callback);
    if (callData.type == CallData::Type::None) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "callback must be a function"_s);
    auto* iterator = iterate(globalObject, backing, IterationKind::Keys);
    for (;;) {
        JSValue key;
        JSValue value;
        bool hasNext;
        if constexpr (isMap<Entries>)
            hasNext = iterator->nextKeyValue(globalObject, key, value);
        else {
            hasNext = iterator->next(globalObject, key);
            value = key;
        }
        RETURN_IF_EXCEPTION(scope, {});
        if (!hasNext)
            return JSValue::encode(jsUndefined());
        MarkedArgumentBuffer arguments;
        arguments.append(value);
        arguments.append(key);
        arguments.append(callFrame->thisValue());
        call(globalObject, callback, callData, callFrame->argument(1), arguments);
        RETURN_IF_EXCEPTION(scope, {});
    }
}

template<typename Entries> EncodedJSValue has(JSGlobalObject* globalObject, CallFrame* callFrame, Entries* backing, ConvertElement convert)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue key = convert(*globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(backing->has(globalObject, key))));
}

template<typename Entries> EncodedJSValue remove(JSGlobalObject* globalObject, CallFrame* callFrame, Entries* backing, ConvertElement convert)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue key = convert(*globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(backing->remove(globalObject, key))));
}

template<typename Entries> EncodedJSValue clear(JSGlobalObject* globalObject, CallFrame*, Entries* backing)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    backing->clear(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

EncodedJSValue get(JSGlobalObject* globalObject, CallFrame* callFrame, JSMap* backing, ConvertElement convert)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue key = convert(*globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(backing->get(globalObject, key)));
}

EncodedJSValue set(JSGlobalObject* globalObject, CallFrame* callFrame, JSMap* backing, ConvertElement convertKey, ConvertElement convertValue)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue key = convertKey(*globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue value = convertValue(*globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    backing->set(globalObject, key, value);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->thisValue());
}

EncodedJSValue add(JSGlobalObject* globalObject, CallFrame* callFrame, JSSet* backing, ConvertElement convert)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = convert(*globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    backing->add(globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->thisValue());
}

#define INSTANTIATE(Entries)                                                               \
    template EncodedJSValue entries(JSGlobalObject*, CallFrame*, Entries*);                \
    template EncodedJSValue values(JSGlobalObject*, CallFrame*, Entries*);                 \
    template EncodedJSValue forEach(JSGlobalObject*, CallFrame*, Entries*);                \
    template EncodedJSValue has(JSGlobalObject*, CallFrame*, Entries*, ConvertElement);    \
    template EncodedJSValue remove(JSGlobalObject*, CallFrame*, Entries*, ConvertElement); \
    template EncodedJSValue clear(JSGlobalObject*, CallFrame*, Entries*);
INSTANTIATE(JSMap)
INSTANTIATE(JSSet)
#undef INSTANTIATE

}

// https://webidl.spec.whatwg.org/#js-observable-arrays
class JSObservableArray final : public JSArray {
public:
    using Base = JSArray;
    // False if it threw.
    using Hook = bool (*)(JSGlobalObject*, JSObject* owner, EncodedJSValue, uint32_t index);
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | OverridesGetOwnPropertyNames | OverridesPut | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero;
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSObservableArray* create(Zig::GlobalObject* globalObject, JSObject* owner, Hook willSet, Hook willDelete)
    {
        VM& vm = getVM(globalObject);
        auto& additions = globalObject->m_bindgenAdditions;
        if (!additions.m_interfaces)
            createInterfaces(globalObject);
        auto& structure = interfacesOf(additions)->observableArrayStructure;
        if (!structure)
            structure.set(vm, globalObject, Structure::create(vm, globalObject, globalObject->arrayPrototype(), TypeInfo(DerivedArrayType, StructureFlags), info(), MayHaveIndexedAccessors));
        JSArray* list = JSArray::create(vm, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous));
        auto* array = new (NotNull, allocateInterfaceCell(vm, info(), sizeof(JSObservableArray), false, false)) JSObservableArray(vm, structure.get(), owner, list, willSet, willDelete);
        array->finishCreation(vm);
        return array;
    }

    unsigned length() const { return m_list->length(); }
    JSValue at(unsigned index) const { return m_list->getIndexQuickly(index); }

    bool setLength(JSGlobalObject* globalObject, unsigned newLength)
    {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        if (newLength > length())
            return false;
        while (length() > newLength) {
            unsigned last = length() - 1;
            m_willDelete(globalObject, m_owner.get(), JSValue::encode(at(last)), last);
            RETURN_IF_EXCEPTION(scope, false);
            m_list->setLength(globalObject, std::min(last, length()));
            RETURN_IF_EXCEPTION(scope, false);
        }
        return true;
    }

    bool setLength(JSGlobalObject* globalObject, JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        uint32_t newLength = value.toUInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        double number = value.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        if (newLength != number) {
            throwRangeError(globalObject, scope, "Invalid array length"_s);
            return false;
        }
        RELEASE_AND_RETURN(scope, setLength(globalObject, newLength));
    }

    bool setIndex(JSGlobalObject* globalObject, unsigned index, JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        if (index > length())
            return false;
        if (index < length()) {
            m_willDelete(globalObject, m_owner.get(), JSValue::encode(at(index)), index);
            RETURN_IF_EXCEPTION(scope, false);
        }
        m_willSet(globalObject, m_owner.get(), JSValue::encode(value), index);
        RETURN_IF_EXCEPTION(scope, false);
        RELEASE_AND_RETURN(scope, m_list->putDirectIndex(globalObject, std::min(index, length()), value));
    }

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        if (name == getVM(globalObject).propertyNames->length) {
            slot.setValue(object, PropertyAttribute::DontDelete | PropertyAttribute::DontEnum, jsNumber(uncheckedDowncast<JSObservableArray>(object)->length()));
            return true;
        }
        if (auto index = parseIndex(name))
            return getOwnPropertySlotByIndex(object, globalObject, *index, slot);
        return JSObject::getOwnPropertySlot(object, globalObject, name, slot);
    }

    static bool getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
    {
        auto* array = uncheckedDowncast<JSObservableArray>(object);
        if (index >= array->length())
            return JSObject::getOwnPropertySlotByIndex(object, globalObject, index, slot);
        slot.setValue(object, 0, array->at(index));
        return true;
    }

    static void getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
    {
        VM& vm = getVM(globalObject);
        for (unsigned i = 0, length = uncheckedDowncast<JSObservableArray>(object)->length(); i < length; ++i)
            names.add(Identifier::from(vm, i));
        object->getOwnNonIndexPropertyNames(globalObject, names, mode);
    }

    static bool put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
    {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* array = uncheckedDowncast<JSObservableArray>(cell);
        auto index = parseIndex(name);
        if (!index && name != vm.propertyNames->length)
            RELEASE_AND_RETURN(scope, JSObject::put(cell, globalObject, name, value, slot));
        bool succeeded = index ? array->setIndex(globalObject, *index, value) : array->setLength(globalObject, value);
        RETURN_IF_EXCEPTION(scope, false);
        return succeeded || typeError(globalObject, scope, slot.isStrictMode(), "Cannot make a hole in this array"_s);
    }

    static bool putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
    {
        PutPropertySlot slot(cell, shouldThrow);
        return put(cell, globalObject, Identifier::from(getVM(globalObject), index), value, slot);
    }

    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot)
    {
        if (name == getVM(globalObject).propertyNames->length)
            return false;
        auto index = parseIndex(name);
        if (!index)
            return JSObject::deleteProperty(cell, globalObject, name, slot);
        auto* array = uncheckedDowncast<JSObservableArray>(cell);
        return *index + 1 == array->length() && array->setLength(globalObject, *index);
    }

    static bool deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index)
    {
        DeletePropertySlot slot;
        return deleteProperty(cell, globalObject, Identifier::from(getVM(globalObject), index), slot);
    }

    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow)
    {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        bool isIndex = parseIndex(name).has_value();
        if (!isIndex && name != vm.propertyNames->length)
            RELEASE_AND_RETURN(scope, JSObject::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow));
        if (descriptor.isAccessorDescriptor()
            || (descriptor.configurablePresent() && descriptor.configurable() != isIndex)
            || (descriptor.enumerablePresent() && descriptor.enumerable() != isIndex)
            || (descriptor.writablePresent() && !descriptor.writable()))
            return typeError(globalObject, scope, shouldThrow, "Cannot change the attributes of this property"_s);
        if (!descriptor.value())
            return true;
        PutPropertySlot slot(object, shouldThrow);
        RELEASE_AND_RETURN(scope, put(object, globalObject, name, descriptor.value(), slot));
    }

    static bool preventExtensions(JSObject*, JSGlobalObject*) { return false; }

private:
    JSObservableArray(VM& vm, Structure* structure, JSObject* owner, JSArray* list, Hook willSet, Hook willDelete)
        : Base(vm, structure, nullptr)
        , m_owner(owner, WriteBarrierEarlyInit)
        , m_list(list, WriteBarrierEarlyInit)
        , m_willSet(willSet)
        , m_willDelete(willDelete)
    {
    }

    WriteBarrier<JSObject> m_owner;
    WriteBarrier<JSArray> m_list;
    Hook m_willSet;
    Hook m_willDelete;
};

const ClassInfo JSObservableArray::s_info = { "Array"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSObservableArray) };

template<typename Visitor>
void JSObservableArray::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSObservableArray>(cell);
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_owner);
    visitor.append(thisObject->m_list);
}
DEFINE_VISIT_CHILDREN(JSObservableArray);

// The name of the interface, which outlives a build in what is stored, and what `serialize` returned.
static Identifier interfaceKey(VM& vm) { return Identifier::fromString(vm, "[[Interface]]"_s); }

bool isSerializableInterface(JSObject* object)
{
    return std::ranges::any_of(Generated::serializableInterfaces, [&](auto& interface) { return object->classInfo() == &Generated::InterfaceInfos::all[interface.number].info; });
}

JSObject* serializeInterface(JSGlobalObject* globalObject, JSObject* object, bool isForStorage)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    for (auto& interface : Generated::serializableInterfaces) {
        const ClassInfo* info = &Generated::InterfaceInfos::all[interface.number].info;
        if (object->classInfo() != info)
            continue;
        JSValue value = JSValue::decode(interface.serialize(globalObject, object, isForStorage));
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSObject* serialized = constructEmptyObject(globalObject);
        serialized->putDirect(vm, interfaceKey(vm), jsString(vm, String(info->className)));
        serialized->putDirect(vm, vm.propertyNames->value, value);
        return serialized;
    }
    return nullptr;
}

JSValue deserializeInterface(JSGlobalObject* globalObject, JSObject* clone)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue nameValue = clone->getDirect(vm, interfaceKey(vm));
    JSValue value = clone->getDirect(vm, vm.propertyNames->value);
    if (!nameValue || !nameValue.isString() || !value)
        return {};
    auto name = asString(nameValue)->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    for (auto& interface : Generated::serializableInterfaces) {
        if (name.data == Generated::InterfaceInfos::all[interface.number].info.className && !removedFeatureAt(reinterpret_cast<const void*>(interface.deserialize)))
            RELEASE_AND_RETURN(scope, JSValue::decode(interface.deserialize(globalObject, JSValue::encode(value))));
    }
    return {};
}

void defineUnforgeables(JSObject* object, unsigned unforgeablesIndex)
{
    VM& vm = object->vm();
    DeferGCForAWhile deferGC(vm);
    auto* realm = defaultGlobalObject(object->globalObject());
    JSObject* holder = interfacesOf(realm->m_bindgenAdditions)->unforgeables[unforgeablesIndex].get();
    holder->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
        copyProperty(vm, realm, holder, object, Identifier::fromUid(vm, entry.key()), holder->getDirect(entry.offset()), entry.attributes());
        return true;
    });
}

// The named property visibility algorithm, but for whether the name is supported.
bool SpecialOperations::isNameHidden(JSObject* object, JSGlobalObject* globalObject, PropertyName name) const
{
    VM& vm = getVM(globalObject);
    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
    if (JSObject::getOwnPropertySlot(object, globalObject, name, slot))
        return true;
    if (overridesBuiltIns)
        return false;
    JSValue prototype = object->getPrototypeDirect();
    return prototype.isObject() && asObject(prototype)->getPropertySlot(globalObject, name, slot);
}

// Empty if there is none, or if it threw.
JSValue SpecialOperations::visibleNamedProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name) const
{
    if (!namedGet || name.isSymbol())
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    bool isHidden = isNameHidden(object, globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (isHidden)
        return {};
    RELEASE_AND_RETURN(scope, JSValue::decode(namedGet(globalObject, object, name.uid())));
}

bool SpecialOperations::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot) const
{
    if (indexedGet) {
        if (auto index = parseIndex(name))
            return getOwnPropertySlotByIndex(object, globalObject, *index, slot);
    }
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = visibleNamedProperty(object, globalObject, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (!value)
        RELEASE_AND_RETURN(scope, JSObject::getOwnPropertySlot(object, globalObject, name, slot));
    unsigned attributes = namedSet ? 0 : static_cast<unsigned>(PropertyAttribute::ReadOnly);
    if (namesAreUnenumerable)
        attributes |= PropertyAttribute::DontEnum;
    slot.setValue(object, attributes, value);
    return true;
}

bool SpecialOperations::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot) const
{
    VM& vm = getVM(globalObject);
    if (!indexedGet || index > MAX_ARRAY_INDEX) [[unlikely]]
        return getOwnPropertySlot(object, globalObject, Identifier::from(vm, index), slot);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(indexedGet(globalObject, object, index));
    RETURN_IF_EXCEPTION(scope, false);
    if (!value)
        return false;
    slot.setValue(object, indexedSet ? 0 : static_cast<unsigned>(PropertyAttribute::ReadOnly), value);
    return true;
}

void SpecialOperations::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode) const
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (indexedGet && names.includeStringProperties()) {
        for (uint32_t i = 0, length = indexedLength(object); i < length; ++i)
            names.add(Identifier::from(vm, i));
    }
    if (namedGet && names.includeStringProperties() && (!namesAreUnenumerable || mode == DontEnumPropertiesMode::Include)) {
        Vector<AtomString> supported;
        namedKeys(globalObject, object, &supported);
        RETURN_IF_EXCEPTION(scope, );
        for (auto& string : supported) {
            auto name = Identifier::fromString(vm, string);
            if (indexedGet && parseIndex(name))
                continue;
            bool isHidden = isNameHidden(object, globalObject, name);
            RETURN_IF_EXCEPTION(scope, );
            if (!isHidden)
                names.add(name);
        }
    }
    scope.release();
    JSObject::getOwnPropertyNames(object, globalObject, names, mode);
}

bool SpecialOperations::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot) const
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSObject* object = asObject(cell);
    auto index = indexedGet ? parseIndex(name) : std::nullopt;
    bool isReceiver = slot.thisValue() == cell;
    if (isReceiver && index && indexedSet)
        RELEASE_AND_RETURN(scope, indexedSet(globalObject, cell, *index, JSValue::encode(value)));
    if (isReceiver && namedSet && !name.isSymbol())
        RELEASE_AND_RETURN(scope, namedSet(globalObject, cell, name.uid(), JSValue::encode(value)));

    PropertyDescriptor own;
    if (index) {
        PropertySlot found(object, PropertySlot::InternalMethodType::GetOwnProperty);
        bool isSupported = getOwnPropertySlotByIndex(object, globalObject, *index, found);
        RETURN_IF_EXCEPTION(scope, false);
        if (isSupported)
            own.setDescriptor(found.getPureResult(), found.attributes());
    } else {
        JSValue named = isReceiver ? visibleNamedProperty(object, globalObject, name) : JSValue();
        RETURN_IF_EXCEPTION(scope, false);
        if (!named) {
            scope.release();
            if (auto ordinaryIndex = isReceiver ? parseIndex(name) : std::nullopt)
                return JSObject::putByIndex(cell, globalObject, *ordinaryIndex, value, slot.isStrictMode());
            bool succeeded = JSObject::put(cell, globalObject, name, value, slot);
            if (namedGet && slot.type() == PutPropertySlot::NewProperty)
                slot.disableCaching();
            return succeeded;
        }
    }
    RELEASE_AND_RETURN(scope, ordinarySetWithOwnDescriptor(globalObject, object, name, value, slot.thisValue(), WTF::move(own), slot.isStrictMode()));
}

bool SpecialOperations::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow) const
{
    if (indexedSet && index <= MAX_ARRAY_INDEX) [[likely]]
        return indexedSet(globalObject, cell, index, JSValue::encode(value));
    PutPropertySlot slot(cell, shouldThrow);
    return put(cell, globalObject, Identifier::from(getVM(globalObject), index), value, slot);
}

bool SpecialOperations::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow) const
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = descriptor.value() ? descriptor.value() : jsUndefined();
    if (auto index = indexedGet ? parseIndex(name) : std::nullopt) {
        if (!descriptor.isDataDescriptor() || !indexedSet)
            return typeError(globalObject, scope, shouldThrow, "Cannot define an indexed property on this object"_s);
        RELEASE_AND_RETURN(scope, indexedSet(globalObject, object, *index, JSValue::encode(value)));
    }
    if (namedGet && !name.isSymbol()) {
        PropertySlot own(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        bool hasOwn = JSObject::getOwnPropertySlot(object, globalObject, name, own);
        own.disallowVMEntry.reset();
        RETURN_IF_EXCEPTION(scope, false);
        bool isUnforgeable = hasOwn && own.isCustom() && (own.attributes() & PropertyAttribute::DontDelete);
        if (!isUnforgeable && (overridesBuiltIns || !hasOwn)) {
            if (namedSet) {
                if (!descriptor.isDataDescriptor())
                    return typeError(globalObject, scope, shouldThrow, "Cannot define an accessor on this object"_s);
                RELEASE_AND_RETURN(scope, namedSet(globalObject, object, name.uid(), JSValue::encode(value)));
            }
            bool isSupported = namedGet(globalObject, object, name.uid());
            RETURN_IF_EXCEPTION(scope, false);
            if (isSupported)
                return typeError(globalObject, scope, shouldThrow, "Cannot redefine a named property of this object"_s);
        }
    }
    RELEASE_AND_RETURN(scope, JSObject::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow));
}

bool SpecialOperations::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot) const
{
    if (auto index = indexedGet ? parseIndex(name) : std::nullopt)
        return *index >= indexedLength(cell);
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue named = visibleNamedProperty(asObject(cell), globalObject, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (named)
        RELEASE_AND_RETURN(scope, namedDelete && namedDelete(globalObject, cell, name.uid()));
    scope.release();
    if (auto ordinaryIndex = parseIndex(name))
        return JSObject::deletePropertyByIndex(cell, globalObject, *ordinaryIndex);
    bool succeeded = JSObject::deleteProperty(cell, globalObject, name, slot);
    if (namedGet)
        slot.disableCaching();
    return succeeded;
}

bool SpecialOperations::deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index) const
{
    DeletePropertySlot slot;
    return deleteProperty(cell, globalObject, Identifier::from(getVM(globalObject), index), slot);
}

JSC_DEFINE_HOST_FUNCTION(callInterfaceObject, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* constructor = uncheckedDowncast<InternalFunction>(callFrame->jsCallee());
    return throwVMTypeError(globalObject, scope, makeString(constructor->name(), " constructor cannot be invoked without 'new'"_s));
}

JSC_DEFINE_HOST_FUNCTION(constructInterfaceObject, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return throwVMTypeError(globalObject, scope, "Illegal constructor"_s);
}

const ClassInfo JSGlobalStandIn::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGlobalStandIn) };

static JSObject* holderOfReceiver(JSGlobalObject* globalObject, JSValue thisValue)
{
    if (thisValue.isUndefinedOrNull())
        return globalObject;
    JSObject* object = thisValue.getObject();
    if (!object)
        return nullptr;
    if (object->type() == GlobalProxyType)
        return uncheckedDowncast<JSGlobalProxy>(object)->target();
    // The `this` of a call that found the function in a scope.
    return object->isEnvironment() && !object->isGlobalObject() ? globalObject : object;
}

static ALWAYS_INLINE JSObject* receiverHeldBy(VM& vm, JSObject* holder)
{
    if (holder->methodTable()->destroy == WebGlobalObject::destroy) [[likely]]
        return uncheckedDowncast<WebGlobalObject>(holder)->m_bindgenAdditions.m_globalReceiver.get();
    if (auto* global = dynamicDowncast<Zig::GlobalObject>(holder))
        return global->m_bindgenAdditions.m_globalReceiver.get();
    return holder->inherits<JSGlobalStandIn>() ? holder->getDirect(vm, WebCore::builtinNames(vm).hostPrivateName()).getObject() : nullptr;
}

JSObject* existingReceiverOf(JSGlobalObject* globalObject, JSValue thisValue)
{
    JSObject* holder = holderOfReceiver(globalObject, thisValue);
    return holder ? receiverHeldBy(getVM(globalObject), holder) : nullptr;
}

void setReceiverOf(VM& vm, JSObject* object, JSObject* receiver)
{
    JSObject* holder = holderOfReceiver(nullptr, object);
    if (auto* global = dynamicDowncast<Zig::GlobalObject>(holder))
        global->m_bindgenAdditions.m_globalReceiver.set(vm, global, receiver);
    else
        holder->putDirect(vm, WebCore::builtinNames(vm).hostPrivateName(), receiver);
}

static void (*globalReceiverInitializer)(Zig::GlobalObject*);

void setGlobalReceiverInitializer(void (*initializer)(Zig::GlobalObject*))
{
    globalReceiverInitializer = initializer;
}

JSValue receiverOfGlobal(JSGlobalObject* globalObject, JSValue thisValue)
{
    JSObject* holder = holderOfReceiver(globalObject, thisValue);
    if (!holder)
        return jsUndefined();
    JSObject* receiver = receiverHeldBy(getVM(globalObject), holder);
    if (!receiver && globalReceiverInitializer) [[unlikely]] {
        if (auto* global = dynamicDowncast<Zig::GlobalObject>(holder)) {
            globalReceiverInitializer(global);
            receiver = global->m_bindgenAdditions.m_globalReceiver.get();
        }
    }
    return receiver ? receiver : jsUndefined();
}

NEVER_INLINE EncodedJSValue throwIllegalInvocation(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return throwVMTypeError(globalObject, scope, "Illegal invocation"_s);
}

NEVER_INLINE EncodedJSValue rejectIllegalInvocation(JSGlobalObject* globalObject)
{
    return JSValue::encode(JSPromise::rejectedPromise(globalObject, createTypeError(globalObject, "Illegal invocation"_s)));
}

EncodedJSValue rejectIfThrown(JSGlobalObject* globalObject, EncodedJSValue result)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (scope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    return result;
}

NEVER_INLINE EncodedJSValue throwTooFewArguments(JSGlobalObject* globalObject, CallFrame* callFrame, unsigned required)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return throwVMTypeError(globalObject, scope, makeString(required, required == 1 ? " argument"_s : " arguments"_s, " required, but only "_s, callFrame->argumentCount(), " present."_s));
}

NEVER_INLINE EncodedJSValue throwNoOverloadTakes(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return throwVMTypeError(globalObject, scope, makeString(callFrame->argumentCount(), " is not a valid number of arguments."_s));
}

static JSObject* visibleReceiver(JSGlobalObject* globalObject, EncodedJSValue thisValue)
{
    JSObject* object = JSValue::decode(thisValue).getObject();
    return object && !object->isEnvironment() ? object : globalObject->globalThis();
}

bool putForwards(JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName name, ASCIILiteral forwardedName, EncodedJSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue target = visibleReceiver(globalObject, thisValue)->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (!target.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, makeString(StringView(name.uid()), " is not an object"_s));
        return false;
    }
    PutPropertySlot slot(target, false);
    RELEASE_AND_RETURN(scope, asObject(target)->methodTable()->put(asObject(target), globalObject, Identifier::fromString(vm, forwardedName), JSValue::decode(value), slot));
}

bool replaceAttribute(JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName name, EncodedJSValue value)
{
    return Replacement::intercepts(name) || visibleReceiver(globalObject, thisValue)->createDataProperty(globalObject, name, JSValue::decode(value), true);
}

}

using namespace Bun::Bindgen;

// For the tests and stores that src/jsc/bindgen.rs does inline.
extern "C" const uint32_t Bun__Bindgen__offsetOfBarrierThreshold = JSC::VM::offsetOfHeapBarrierThreshold();
extern "C" const uintptr_t Bun__Bindgen__blockMask = JSC::MarkedBlock::blockMask;
static_assert(JSC::MarkedBlock::offsetOfHeader + JSC::MarkedBlock::Header::offsetOfVM() == 8);
static_assert(JSC::PreciseAllocation::halfAlignment == 8);
static_assert(JSC::JSCell::typeInfoTypeOffset() == 5 && JSC::JSCell::cellStateOffset() == 7);
static_assert(WebCore::JSInterfaceType == 0xE0 && WebCore::JSInterfaceWithInlineStorageType == 0xE1);
static_assert(WebCore::numberOfInterfaceCellSizes * JSC::MarkedBlock::atomSize == 512);

extern "C" void Bun__Bindgen__writeBarrier(JSC::JSCell* from, JSC::JSCell* to)
{
    from->vm().writeBarrier(from, to);
}

extern "C" JSC::JSObject* Bun__Bindgen__constructorForInterface(JSC::JSGlobalObject* globalObject, uint32_t number)
{
    return constructorForInterface(globalObject, number);
}

extern "C" JSC::EncodedJSValue Bun__Bindgen__interfaceObjectNamed(JSC::JSGlobalObject* globalObject, WTF::StringImpl* name)
{
    return JSC::JSValue::encode(Bun::Bindgen::interfaceObjectNamed(globalObject, *name));
}

extern "C" JSC::JSObject* Bun__Bindgen__prototypeForInterface(JSC::JSGlobalObject* globalObject, uint32_t number)
{
    return prototypeForInterface(globalObject, number);
}

extern "C" JSC::Structure* Bun__Bindgen__structureForNewTarget(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue newTarget, uint32_t number)
{
    return interfaceStructureForNewTarget(globalObject, JSC::JSValue::decode(newTarget), number);
}

extern "C" JSC::Structure* Bun__Bindgen__structureWithPrototype(JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype, uint32_t number)
{
    auto* base = structureForInterface(globalObject, number);
    if (base->storedPrototypeObject() == prototype)
        return base;
    return base->realm()->structureCache().emptyStructureForPrototypeFromBaseStructure(base->realm(), prototype, base);
}

extern "C" JSC::JSGlobalObject* Bun__Bindgen__realmOf(JSC::JSObject* object)
{
    return object->globalObject();
}

extern "C" JSC::JSObject* Bun__Bindgen__instanceOfRealm(JSC::JSGlobalObject* globalObject, uint32_t number)
{
    return Bun::Bindgen::instanceOfRealm(globalObject, number);
}

extern "C" void Bun__Bindgen__setInstanceOfRealm(JSC::JSGlobalObject* globalObject, uint32_t number, JSC::JSObject* instance)
{
    Bun::Bindgen::setInstanceOfRealm(globalObject, number, instance);
}

extern "C" void Bun__Bindgen__setGlobalReceiver(JSC::JSGlobalObject* globalObject, JSC::JSObject* receiver)
{
    uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_bindgenAdditions.m_globalReceiver.set(JSC::getVM(globalObject), globalObject, receiver);
}

extern "C" JSC::JSObject* Bun__Bindgen__globalReceiver(JSC::JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->m_bindgenAdditions.m_globalReceiver.get();
}

extern "C" JSC::EncodedJSValue Bun__Bindgen__stringFromImpl(JSC::JSGlobalObject* globalObject, WTF::StringImpl* impl)
{
    return JSC::JSValue::encode(JSC::jsStringWithCache(JSC::getVM(globalObject), *reinterpret_cast<const WTF::String*>(&impl)));
}

// Null if there is none, or if it is a termination, which stays.
extern "C" JSC::Exception* Bun__Bindgen__setExceptionAside(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
    auto* exception = scope.exception();
    return exception && scope.clearExceptionExceptTermination() ? exception : nullptr;
}

extern "C" void Bun__Bindgen__restoreException(JSC::JSGlobalObject* globalObject, JSC::Exception* exception)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    scope.throwException(globalObject, exception);
}

extern "C" void Bun__Bindgen__addPropertyName(WTF::Vector<WTF::AtomString>* names, WTF::StringImpl* name)
{
    names->append(WTF::AtomString(name));
}

extern "C" void Bun__Bindgen__addUTF8PropertyName(WTF::Vector<WTF::AtomString>* names, const uint8_t* name, size_t length)
{
    names->append(WTF::AtomString(WTF::String::fromUTF8ReplacingInvalidSequences({ name, length })));
}

// What has been cached is for the structure that it had. The new one is its own, and whoever caches next flattens it.
extern "C" void Bun__Bindgen__announceNamedProperty(JSC::JSObject* object)
{
    object->convertToUncacheableDictionary(object->vm());
    object->structure()->setHasBeenFlattenedBefore(false);
}

extern "C" bool Bun__Bindgen__hasEntry(JSC::JSGlobalObject* globalObject, JSC::JSCell* entries, JSC::EncodedJSValue key)
{
    if (auto* map = dynamicDowncast<JSC::JSMap>(entries))
        return map->has(globalObject, JSC::JSValue::decode(key));
    return uncheckedDowncast<JSC::JSSet>(entries)->has(globalObject, JSC::JSValue::decode(key));
}

extern "C" bool Bun__Bindgen__removeEntry(JSC::JSGlobalObject* globalObject, JSC::JSCell* entries, JSC::EncodedJSValue key)
{
    if (auto* map = dynamicDowncast<JSC::JSMap>(entries))
        return map->remove(globalObject, JSC::JSValue::decode(key));
    return uncheckedDowncast<JSC::JSSet>(entries)->remove(globalObject, JSC::JSValue::decode(key));
}

extern "C" void Bun__Bindgen__addEntry(JSC::JSGlobalObject* globalObject, JSC::JSCell* entries, JSC::EncodedJSValue key, JSC::EncodedJSValue value)
{
    if (auto* map = dynamicDowncast<JSC::JSMap>(entries))
        return map->set(globalObject, JSC::JSValue::decode(key), JSC::JSValue::decode(value));
    uncheckedDowncast<JSC::JSSet>(entries)->add(globalObject, JSC::JSValue::decode(key));
}

extern "C" void Bun__Bindgen__clearEntries(JSC::JSGlobalObject* globalObject, JSC::JSCell* entries)
{
    if (auto* map = dynamicDowncast<JSC::JSMap>(entries))
        return map->clear(globalObject);
    uncheckedDowncast<JSC::JSSet>(entries)->clear(globalObject);
}

extern "C" JSC::EncodedJSValue Bun__Bindgen__getEntry(JSC::JSGlobalObject* globalObject, JSC::JSMap* map, JSC::EncodedJSValue key)
{
    return JSC::JSValue::encode(map->get(globalObject, JSC::JSValue::decode(key)));
}

// The keys and the values of a map alternate.
extern "C" JSC::JSCell* Bun__Bindgen__listEntries(JSC::JSGlobalObject* globalObject, JSC::JSCell* entries)
{
    JSC::MarkedArgumentBuffer list;
    JSC::JSValue key;
    JSC::JSValue value;
    if (auto* map = dynamicDowncast<JSC::JSMap>(entries)) {
        for (auto* iterator = Collection::iterate(globalObject, map, JSC::IterationKind::Keys); iterator->nextKeyValue(globalObject, key, value);) {
            list.appendWithCrashOnOverflow(key);
            list.appendWithCrashOnOverflow(value);
        }
    } else {
        for (auto* iterator = Collection::iterate(globalObject, uncheckedDowncast<JSC::JSSet>(entries), JSC::IterationKind::Keys); iterator->next(globalObject, key);)
            list.appendWithCrashOnOverflow(key);
    }
    return Bun::Bindgen::createList(*globalObject, list);
}

extern "C" JSC::JSObject* Bun__Bindgen__createIteratorResult(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value, bool isDone)
{
    return JSC::createIteratorResultObject(globalObject, JSC::JSValue::decode(value), isDone);
}

extern "C" uint8_t Bun__Bindgen__exposure(JSC::JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->m_bindgenAdditions.m_exposure;
}

extern "C" JSC::EncodedJSValue Bun__Bindgen__createTypedArray(JSC::JSGlobalObject* globalObject, JSC::JSType kind, const void* elements, size_t count)
{
    auto create = [&]<typename View>() -> JSC::EncodedJSValue {
        auto* view = View::createUninitialized(globalObject, globalObject->typedArrayStructure(JSC::typedArrayType(kind), false), count);
        if (view && count)
            memcpy(view->vector(), elements, view->byteLength());
        return JSC::JSValue::encode(view);
    };
    switch (kind) {
#define CASE(name)             \
    case JSC::name##ArrayType: \
        return create.template operator()<JSC::JS##name##Array>();
        CASE(Int8)
        CASE(Uint8)
        CASE(Int16)
        CASE(Uint16)
        CASE(Int32)
        CASE(Uint32)
        CASE(Float32)
        CASE(Float64)
#undef CASE
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

extern "C" JSC::JSObject* Bun__Bindgen__createObservableArray(JSC::JSGlobalObject* globalObject, JSC::JSObject* owner, JSObservableArray::Hook willSet, JSObservableArray::Hook willDelete)
{
    return JSObservableArray::create(defaultGlobalObject(globalObject), owner, willSet, willDelete);
}

extern "C" JSC::JSCell* Bun__Bindgen__observableArrayValues(JSC::JSGlobalObject* globalObject, JSObservableArray* array)
{
    JSC::MarkedArgumentBuffer values;
    for (unsigned i = 0; i < array->length(); ++i)
        values.appendWithCrashOnOverflow(array->at(i));
    return Bun::Bindgen::createList(*globalObject, values);
}

extern "C" bool Bun__Bindgen__replaceObservableArray(JSC::JSGlobalObject* globalObject, JSObservableArray* array, const JSC::EncodedJSValue* values, size_t count)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    array->setLength(globalObject, 0u);
    RETURN_IF_EXCEPTION(scope, false);
    for (size_t i = 0; i < count; ++i) {
        array->setIndex(globalObject, i, JSC::JSValue::decode(values[i]));
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}
