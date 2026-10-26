// `SharedStruct` and `SharedArray`: JS views over the atomic slots of a Rust `SharedBlock` (src/shared_struct).
//
// The views are exotic objects, like process.env (JSEnvironmentVariableMap.cpp): a property is a slot, found by name or by index,
// and a read or write goes to Rust, which converts between a JSValue and what a slot holds. Mutex and Condition are not here: they
// are ordinary generated classes (src/shared_struct_jsc/shared_struct_classes.bind.ts).

#include "SharedStructObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/WeakGCMapInlines.h>

// Rust, in src/shared_struct_jsc/shared_struct_classes.rs.
extern "C" {
// A new block, or null with an exception pending.
const void* Bun__SharedStruct__newBlock(JSC::JSGlobalObject*, JSC::EncodedJSValue names);
const void* Bun__SharedArray__newBlock(JSC::JSGlobalObject*, JSC::EncodedJSValue length);
}

// Rust, which makes a new Mutex or Condition object.
extern "C" JSC::EncodedJSValue Bun__SharedMutex__create(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__SharedCondition__create(JSC::JSGlobalObject*);

// ZigGlobalObject.cpp: loads the structs surface in a realm if that has not happened yet.
extern "C" void Bun__ensureStructsSurface(JSC::JSGlobalObject*);

// Defined at the end of this file, which is also where Rust calls them.
extern "C" JSC::EncodedJSValue Bun__SharedBlock__wrap(JSC::JSGlobalObject*, const void* block);

namespace Bun {
using namespace JSC;

// The JS object that stands for each shared object in one realm: a shared struct or array view, a Mutex or a Condition. A block that
// reaches a realm twice, through two parents or a structured clone, is the same object there for as long as that object is alive. It
// is held weakly, so a view nobody references is free to go. The registry is a cell that the global object holds in a private property.
class SharedObjectRegistry final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::CompleteSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    DECLARE_INFO;

    static SharedObjectRegistry* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        auto* registry = new (NotNull, JSC::allocateCell<SharedObjectRegistry>(vm)) SharedObjectRegistry(vm, structure);
        registry->finishCreation(vm);
        return registry;
    }

    static void destroy(JSC::JSCell* cell) { static_cast<SharedObjectRegistry*>(cell)->~SharedObjectRegistry(); }
    ~SharedObjectRegistry() = default;

    JSC::JSObject* get(const void* key) const { return m_objects.get(key); }
    void set(const void* key, JSC::JSObject* object) { m_objects.set(key, object); }

    DECLARE_VISIT_CHILDREN;

    // The symbols of this realm that a shared slot has held, which are not registered: each has a number that every agent agrees on.
    // They stay as long as the realm does, so that the number keeps naming the same symbol.
    JSC::Symbol* symbolFor(uint64_t id)
    {
        WTF::Locker locker { cellLock() };
        auto it = m_symbols.find(id);
        return it == m_symbols.end() ? nullptr : it->value.get();
    }

    std::optional<uint64_t> idOf(const void* uid)
    {
        WTF::Locker locker { cellLock() };
        auto it = m_ids.find(uid);
        if (it == m_ids.end())
            return std::nullopt;
        return it->value;
    }

    void remember(JSC::VM& vm, uint64_t id, JSC::Symbol* symbol)
    {
        WTF::Locker locker { cellLock() };
        m_symbols.add(id, JSC::WriteBarrier<JSC::Symbol>()).iterator->value.set(vm, this, symbol);
        m_ids.set(&symbol->uid(), id);
    }

private:
    SharedObjectRegistry(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_objects(vm)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
    }

    JSC::WeakGCMap<const void*, JSC::JSObject> m_objects;
    WTF::HashMap<uint64_t, JSC::WriteBarrier<JSC::Symbol>> m_symbols;
    WTF::HashMap<const void*, uint64_t> m_ids;
};

template<typename Visitor>
void SharedObjectRegistry::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<SharedObjectRegistry>(cell);
    Base::visitChildren(thisObject, visitor);
    WTF::Locker locker { thisObject->cellLock() };
    for (auto& entry : thisObject->m_symbols.values())
        visitor.append(entry);
}

DEFINE_VISIT_CHILDREN(SharedObjectRegistry);

const ClassInfo SharedObjectRegistry::s_info = { "SharedObjectRegistry"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(SharedObjectRegistry) };

// The registry of `globalObject`'s realm, made on first use when `create` is set.
static SharedObjectRegistry* registryOf(VM& vm, JSGlobalObject* globalObject, bool create)
{
    const Identifier& name = builtinNames(vm).dataPrivateName();
    if (JSValue existing = globalObject->getDirect(vm, name))
        return uncheckedDowncast<SharedObjectRegistry>(existing.asCell());
    if (!create)
        return nullptr;
    auto* registry = SharedObjectRegistry::create(vm, globalObject);
    globalObject->putDirect(vm, name, registry, static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    return registry;
}

static constexpr unsigned slotAttributes = static_cast<unsigned>(PropertyAttribute::DontDelete);
static constexpr unsigned lengthAttributes = static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

// Reads slot `index` into `slot`. `in` and VM inquiries must not run the read, which can allocate.
static bool loadSlot(JSSharedView* object, size_t index, JSGlobalObject* globalObject, PropertySlot& slot)
{
    if (slot.internalMethodType() == PropertySlot::InternalMethodType::HasProperty
        || slot.internalMethodType() == PropertySlot::InternalMethodType::VMInquiry) {
        slot.setValue(object, slotAttributes, jsUndefined());
        return true;
    }
    JSValue value = object->load(globalObject, index);
    if (!value) {
        // An exception is pending.
        return false;
    }
    slot.setValue(object, slotAttributes, value);
    return true;
}

template<typename Visitor>
void JSSharedView::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    // A view has no ClassInfo of its own, so this cannot check it.
    auto* thisObject = static_cast<JSSharedView*>(cell);
    Base::visitChildren(thisObject, visitor);
    WTF::Locker locker { thisObject->cellLock() };
    for (auto& entry : thisObject->m_cache.values())
        visitor.append(entry.wrapper);
}

DEFINE_VISIT_CHILDREN(JSSharedView);

void JSSharedView::remember(VM& vm, size_t index, const void* key, JSObject* object)
{
    WTF::Locker locker { cellLock() };
    if (key && object) {
        SlotCache& entry = m_cache.add(index, SlotCache()).iterator->value;
        if (object != entry.wrapper.get())
            entry.wrapper.set(vm, this, object);
        entry.key = key;
    } else {
        auto it = m_cache.find(index);
        if (it != m_cache.end()) {
            it->value.wrapper.clear();
            it->value.key = nullptr;
        }
    }
}

JSObject* JSSharedView::cachedWrapper(size_t index, const void* key) const
{
    WTF::Locker locker { cellLock() };
    auto it = m_cache.find(index);
    if (it == m_cache.end())
        return nullptr;
    return key && it->value.key == key ? it->value.wrapper.get() : nullptr;
}

JSValue JSSharedView::load(JSGlobalObject* globalObject, size_t index)
{
    VM& vm = getVM(globalObject);
    const void* cachedKey = nullptr;
    JSObject* cached = nullptr;
    {
        WTF::Locker locker { cellLock() };
        auto it = m_cache.find(index);
        if (it != m_cache.end()) {
            cachedKey = it->value.key;
            cached = it->value.wrapper.get();
        }
    }
    const void* key = nullptr;
    // Rust hands back the cached wrapper when the slot still holds the object behind it.
    JSValue value = JSValue::decode(Bun__SharedBlock__load(m_block, index, globalObject, cachedKey, JSValue::encode(JSValue(cached)), &key));
    if (!value) {
        // An exception is pending.
        return {};
    }
    remember(vm, index, key, key ? value.getObject() : nullptr);
    return value;
}

bool JSSharedView::store(JSGlobalObject* globalObject, size_t index, JSValue value)
{
    VM& vm = getVM(globalObject);
    const void* key = nullptr;
    if (!Bun__SharedBlock__store(m_block, index, globalObject, JSValue::encode(value), &key)) {
        // An exception is pending.
        return false;
    }
    remember(vm, index, key, key ? value.getObject() : nullptr);
    return true;
}

bool JSSharedView::redefineSlot(JSGlobalObject* globalObject, size_t index, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // [[DefineOwnProperty]] of a shared struct refuses a descriptor that makes the field non-enumerable, configurable or read-only. It
    // reads nothing else but [[Value]], so an accessor descriptor is accepted and changes nothing (the text of the proposal).
    if ((descriptor.configurablePresent() && descriptor.configurable())
        || (descriptor.enumerablePresent() && !descriptor.enumerable())
        || (descriptor.writablePresent() && !descriptor.writable())) {
        if (shouldThrow)
            throwVMTypeError(globalObject, scope, "Cannot redefine a shared struct or shared array property"_s);
        return false;
    }
    if (!descriptor.value())
        return true;
    return store(globalObject, index, descriptor.value());
}

// ─────────────────────────────────────────────────────────────────────────────
// SharedStruct
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSSharedStruct::s_info = { "SharedStruct"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSharedStruct) };

JSSharedStruct* JSSharedStruct::create(VM& vm, JSGlobalObject* globalObject, const void* block)
{
    auto* structure = createStructure(vm, globalObject);
    auto* ptr = new (NotNull, allocateCell<JSSharedStruct>(vm)) JSSharedStruct(vm, structure, block);
    ptr->finishCreation(vm);
    return ptr;
}

void JSSharedStruct::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    size_t count = Bun__SharedBlock__length(m_block);
    m_names.reserveInitialCapacity(count);
    for (size_t i = 0; i < count; i++) {
        const char16_t* chars = nullptr;
        size_t length = 0;
        Bun__SharedBlock__fieldName(m_block, i, &chars, &length);
        m_names.append(Identifier::fromString(vm, std::span<const char16_t>(chars, length)));
        m_slots.add(m_names.last().impl(), i);
    }
}

std::optional<size_t> JSSharedStruct::slotOf(PropertyName propertyName) const
{
    auto* uid = propertyName.uid();
    if (!uid)
        return std::nullopt;
    auto it = m_slots.find(uid);
    if (it == m_slots.end())
        return std::nullopt;
    return it->value;
}

bool JSSharedStruct::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(object);
    if (auto index = self->slotOf(propertyName))
        return loadSlot(self, *index, globalObject, slot);
    return Base::getOwnPropertySlot(object, globalObject, propertyName, slot);
}

// A property that is not a field cannot be written. [[Set]] ignores the receiver: it writes the field of this struct, and adds nothing to
// the receiver when there is no such field.
static bool refuseWrite(JSGlobalObject* globalObject, PutPropertySlot& slot, ASCIILiteral message)
{
    if (slot.isStrictMode()) {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwVMTypeError(globalObject, scope, message);
    }
    return false;
}

bool JSSharedStruct::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(object);
    if (auto slotIndex = self->slotOf(Identifier::from(getVM(globalObject), index)))
        return loadSlot(self, *slotIndex, globalObject, slot);
    return Base::getOwnPropertySlotByIndex(object, globalObject, index, slot);
}

bool JSSharedStruct::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(cell);
    if (auto index = self->slotOf(propertyName))
        return self->store(globalObject, *index, value);
    return refuseWrite(globalObject, slot, "Cannot add a property to a shared struct"_s);
}

bool JSSharedStruct::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(object);
    if (auto index = self->slotOf(propertyName))
        return self->redefineSlot(globalObject, *index, descriptor, shouldThrow);
    return Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow);
}

bool JSSharedStruct::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(cell);
    VM& vm = getVM(globalObject);
    if (auto slotIndex = self->slotOf(Identifier::from(vm, index)))
        return self->store(globalObject, *slotIndex, value);
    if (shouldThrow) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwVMTypeError(globalObject, scope, "Cannot add a property to a shared struct"_s);
    }
    return false;
}

// [[Delete]] of a shared struct returns false for every key.
bool JSSharedStruct::deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&)
{
    return false;
}

bool JSSharedStruct::deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned)
{
    return false;
}

void JSSharedStruct::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(object);
    // Names that are array indices come first in ascending order, then the others in the order they were declared, as for any object.
    WTF::Vector<std::pair<uint32_t, size_t>> indexed;
    for (size_t i = 0; i < self->m_names.size(); i++) {
        if (auto index = parseIndex(self->m_names[i]))
            indexed.append({ *index, i });
    }
    std::sort(indexed.begin(), indexed.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    for (const auto& entry : indexed)
        names.add(self->m_names[entry.second]);
    for (const auto& name : self->m_names) {
        if (!parseIndex(name))
            names.add(name);
    }
    Base::getOwnPropertyNames(object, globalObject, names, mode);
}

// ─────────────────────────────────────────────────────────────────────────────
// SharedArray
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSSharedArray::s_info = { "SharedArray"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSharedArray) };

JSSharedArray* JSSharedArray::create(VM& vm, JSGlobalObject* globalObject, const void* block)
{
    auto* structure = createStructure(vm, globalObject);
    auto* ptr = new (NotNull, allocateCell<JSSharedArray>(vm)) JSSharedArray(vm, structure, block);
    ptr->finishCreation(vm);
    return ptr;
}

void JSSharedArray::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

bool JSSharedArray::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedArray>(object);
    if (index < self->m_length)
        return loadSlot(self, index, globalObject, slot);
    return Base::getOwnPropertySlotByIndex(object, globalObject, index, slot);
}

bool JSSharedArray::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedArray>(object);
    VM& vm = getVM(globalObject);
    if (propertyName == vm.propertyNames->length) {
        slot.setValue(self, lengthAttributes, jsNumber(static_cast<double>(self->m_length)));
        return true;
    }
    if (auto index = parseIndex(propertyName))
        return getOwnPropertySlotByIndex(object, globalObject, *index, slot);
    return Base::getOwnPropertySlot(object, globalObject, propertyName, slot);
}

bool JSSharedArray::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    auto* self = uncheckedDowncast<JSSharedArray>(cell);
    if (index < self->m_length)
        return self->store(globalObject, index, value);
    // Not extensible: this refuses an index past the end.
    return Base::putByIndex(cell, globalObject, index, value, shouldThrow);
}

bool JSSharedArray::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    if (auto index = parseIndex(propertyName))
        return putByIndex(cell, globalObject, *index, value, slot.isStrictMode());
    // The length is read-only and no other name is a property.
    return refuseWrite(globalObject, slot, "Cannot add a property to a shared array or change its length"_s);
}

bool JSSharedArray::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    auto* self = uncheckedDowncast<JSSharedArray>(object);
    VM& vm = getVM(globalObject);
    if (propertyName == vm.propertyNames->length) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (shouldThrow)
            throwVMTypeError(globalObject, scope, "Cannot redefine the length of a shared array"_s);
        return false;
    }
    if (auto index = parseIndex(propertyName)) {
        if (*index < self->m_length)
            return self->redefineSlot(globalObject, *index, descriptor, shouldThrow);
    }
    return Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow);
}

// [[Delete]] returns false for every key: an element, the length, and a name that is not a property at all.
bool JSSharedArray::deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned)
{
    return false;
}

bool JSSharedArray::deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&)
{
    return false;
}

void JSSharedArray::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    auto* self = uncheckedDowncast<JSSharedArray>(object);
    VM& vm = getVM(globalObject);
    for (size_t i = 0; i < self->m_length; i++)
        names.add(Identifier::from(vm, static_cast<unsigned>(i)));
    if (mode == DontEnumPropertiesMode::Include)
        names.add(vm.propertyNames->length);
    Base::getOwnPropertyNames(object, globalObject, names, mode);
}

// ─────────────────────────────────────────────────────────────────────────────
// What Rust calls, and the constructors it hands to JS
// ─────────────────────────────────────────────────────────────────────────────

JSC_DECLARE_HOST_FUNCTION(callSharedStruct);
JSC_DECLARE_HOST_FUNCTION(constructSharedStruct);
JSC_DECLARE_HOST_FUNCTION(callSharedArray);
JSC_DECLARE_HOST_FUNCTION(constructSharedArray);
JSC_DECLARE_HOST_FUNCTION(callMutex);
JSC_DECLARE_HOST_FUNCTION(constructMutex);
JSC_DECLARE_HOST_FUNCTION(callCondition);
JSC_DECLARE_HOST_FUNCTION(constructCondition);

JSC_DEFINE_HOST_FUNCTION(callSharedStruct, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Constructor SharedStruct requires 'new'"_s);
}

// `new SharedStruct(fieldNames)`. Rust validates the names and makes the block.
JSC_DEFINE_HOST_FUNCTION(constructSharedStruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const void* block = Bun__SharedStruct__newBlock(globalObject, JSValue::encode(callFrame->argument(0)));
    RETURN_IF_EXCEPTION(scope, {});
    return Bun__SharedBlock__wrap(globalObject, block);
}

JSC_DEFINE_HOST_FUNCTION(callSharedArray, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Constructor SharedArray requires 'new'"_s);
}

// `new SharedArray(...values)`: no argument is an empty array, one is the length, two or more are the elements.
JSC_DEFINE_HOST_FUNCTION(constructSharedArray, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    unsigned argumentCount = callFrame->argumentCount();
    JSValue length = jsNumber(argumentCount);
    if (argumentCount == 0)
        length = jsNumber(0);
    else if (argumentCount == 1) {
        length = callFrame->uncheckedArgument(0);
        if (!length.isNumber() || !std::isfinite(length.asNumber()) || std::trunc(length.asNumber()) != length.asNumber())
            return throwVMTypeError(globalObject, scope, "SharedArray length must be an integral Number"_s);
        if (length.asNumber() < 0 || length.asNumber() > std::numeric_limits<uint32_t>::max())
            return throwVMRangeError(globalObject, scope, "Invalid SharedArray length"_s);
    }
    const void* block = Bun__SharedArray__newBlock(globalObject, JSValue::encode(length));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue result = JSValue::decode(Bun__SharedBlock__wrap(globalObject, block));
    if (argumentCount >= 2) {
        JSObject* array = asObject(result);
        for (unsigned i = 0; i < argumentCount; ++i) {
            array->methodTable()->putByIndex(array, globalObject, i, callFrame->uncheckedArgument(i), true);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(callMutex, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Constructor Atomics.Mutex requires 'new'"_s);
}

// `new Atomics.Mutex()`: Rust makes the object, which has no prototype and cannot be extended.
JSC_DEFINE_HOST_FUNCTION(constructMutex, (JSGlobalObject * globalObject, CallFrame*))
{
    return Bun__SharedMutex__create(globalObject);
}

JSC_DEFINE_HOST_FUNCTION(callCondition, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Constructor Atomics.Condition requires 'new'"_s);
}

JSC_DEFINE_HOST_FUNCTION(constructCondition, (JSGlobalObject * globalObject, CallFrame*))
{
    return Bun__SharedCondition__create(globalObject);
}

}

extern "C" {

// The view of `block` in the realm of `globalObject`: the one that is there if it is alive, else a new one. Takes the caller's strong count
// of `block`.
JSC::EncodedJSValue Bun__SharedBlock__wrap(JSC::JSGlobalObject* globalObject, const void* block)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A realm that is handed a shared struct has to be able to use Atomics on it before any script reads one of the lazy names.
    Bun__ensureStructsSurface(globalObject);
    if (scope.exception()) {
        Bun__SharedBlock__release(block);
        return JSC::JSValue::encode(JSC::JSValue());
    }
    auto* registry = Bun::registryOf(vm, globalObject, true);
    if (JSC::JSObject* existing = registry->get(block)) {
        Bun__SharedBlock__release(block);
        return JSC::JSValue::encode(existing);
    }
    JSC::JSObject* view;
    if (Bun__SharedBlock__isStruct(block))
        view = Bun::JSSharedStruct::create(vm, globalObject, block);
    else
        view = Bun::JSSharedArray::create(vm, globalObject, block);
    view->methodTable()->preventExtensions(view, globalObject);
    registry->set(block, view);
    return JSC::JSValue::encode(view);
}

// For Rust, before it makes a Mutex or a Condition in `globalObject`: loads the structs surface there if that has not happened.
// Undefined, or empty with an exception pending.
JSC::EncodedJSValue Bun__SharedSurface__ensure(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun__ensureStructsSurface(globalObject);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue()));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// The object that stands for the shared object at `key` in this realm if there is one alive, else empty. Used for a Mutex or a Condition.
JSC::EncodedJSValue Bun__SharedObject__lookup(JSC::JSGlobalObject* globalObject, const void* key)
{
    auto* registry = Bun::registryOf(globalObject->vm(), globalObject, false);
    JSC::JSObject* existing = registry ? registry->get(key) : nullptr;
    return JSC::JSValue::encode(existing ? JSC::JSValue(existing) : JSC::JSValue());
}

void Bun__SharedObject__register(JSC::JSGlobalObject* globalObject, const void* key, JSC::EncodedJSValue encoded)
{
    if (auto* object = JSC::JSValue::decode(encoded).getObject())
        Bun::registryOf(globalObject->vm(), globalObject, true)->set(key, object);
}

static std::atomic<uint64_t> nextSymbolId { 1 };

// What a symbol stands for across agents (see SymbolRecord in src/shared_struct/value.rs). A registered symbol is named by its key, which
// is its description. Any other symbol gets a number the first time it is stored, kept for as long as the realm lives.
bool Bun__SharedSymbol__describe(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encoded, uint64_t* id, bool* registered, const char16_t** chars, size_t* length, bool* hasDescription)
{
    JSC::JSValue value = JSC::JSValue::decode(encoded);
    if (!value.isSymbol())
        return false;
    JSC::VM& vm = globalObject->vm();
    auto* symbol = JSC::asSymbol(value);
    WTF::SymbolImpl& uid = symbol->uid();
    *registered = !!uid.symbolRegistry();
    *id = 0;
    if (!*registered) {
        auto* registry = Bun::registryOf(vm, globalObject, true);
        if (auto existing = registry->idOf(&uid))
            *id = *existing;
        else {
            *id = nextSymbolId.fetch_add(1);
            registry->remember(vm, *id, symbol);
        }
    }
    // The description, widened to UTF-16 in storage that lasts until the next call on this thread.
    static thread_local WTF::Vector<char16_t> text;
    text.clear();
    // The impl of a symbol is a string holding its description, and a null symbol has none.
    *hasDescription = !uid.isNullSymbol();
    if (*hasDescription) {
        WTF::String description(uid);
        text.reserveCapacity(description.length());
        for (unsigned i = 0; i < description.length(); i++)
            text.append(description[i]);
    }
    *chars = text.span().data();
    *length = text.size();
    return true;
}

// The symbol of this realm that a record stands for: the one it already has, or a new one.
JSC::EncodedJSValue Bun__SharedSymbol__make(JSC::JSGlobalObject* globalObject, uint64_t id, bool registered, const char16_t* chars, size_t length, bool hasDescription)
{
    JSC::VM& vm = globalObject->vm();
    WTF::String description = hasDescription ? WTF::String(std::span<const char16_t>(chars, length)) : WTF::String();
    if (registered)
        return JSC::JSValue::encode(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(description)));
    auto* registry = Bun::registryOf(vm, globalObject, true);
    if (auto* existing = registry->symbolFor(id))
        return JSC::JSValue::encode(existing);
    auto* symbol = hasDescription ? JSC::Symbol::createWithDescription(vm, description) : JSC::Symbol::create(vm);
    registry->remember(vm, id, symbol);
    return JSC::JSValue::encode(symbol);
}

// Makes `object`, a Mutex or a Condition that was just made, what the proposal says those are: an object with no prototype that cannot
// be extended, so nothing but the functions of `Atomics.Mutex` and `Atomics.Condition` can reach the lock.
void Bun__SharedObject__makeBare(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encoded)
{
    JSC::JSObject* object = JSC::JSValue::decode(encoded).getObject();
    object->setPrototypeDirect(globalObject->vm(), JSC::jsNull());
    object->methodTable()->preventExtensions(object, globalObject);
}

static Bun::JSSharedView* sharedViewOf(JSC::JSValue value)
{
    if (auto* view = dynamicDowncast<Bun::JSSharedStruct>(value))
        return view;
    if (auto* view = dynamicDowncast<Bun::JSSharedArray>(value))
        return view;
    return nullptr;
}

// The wrapper that slot `index` of the view `encoded` last gave out or took in, if it is the one for the object at `key`; else empty.
// `index` is below the length of the view's block.
JSC::EncodedJSValue Bun__SharedView__cachedWrapper(JSC::EncodedJSValue encoded, size_t index, const void* key)
{
    auto* view = sharedViewOf(JSC::JSValue::decode(encoded));
    if (!view)
        return JSC::JSValue::encode(JSC::JSValue());
    return JSC::JSValue::encode(JSC::JSValue(view->cachedWrapper(index, key)));
}

// Records that slot `index` of the view `encoded` now holds the object at `key`, whose wrapper is `wrapper`. A null `key` clears the entry.
void Bun__SharedView__remember(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encoded, size_t index, const void* key, JSC::EncodedJSValue wrapper)
{
    if (auto* view = sharedViewOf(JSC::JSValue::decode(encoded)))
        view->remember(globalObject->vm(), index, key, JSC::JSValue::decode(wrapper).getObject());
}

// The block of a SharedStruct or SharedArray view, or null for any other value.
const void* Bun__SharedBlock__fromJS(JSC::EncodedJSValue encoded)
{
    JSC::JSValue value = JSC::JSValue::decode(encoded);
    if (auto* view = dynamicDowncast<Bun::JSSharedStruct>(value))
        return view->block();
    if (auto* view = dynamicDowncast<Bun::JSSharedArray>(value))
        return view->block();
    return nullptr;
}

// `{ Mutex, Condition, SharedArray, SharedStruct }`: the constructors of this realm. Rust passes the two it generated.
JSC::EncodedJSValue Bun__SharedStruct__createConstructors(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue mutex, JSC::EncodedJSValue condition)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSObject* classes = JSC::constructEmptyObject(globalObject);
    // `Mutex` and `Condition` are functions without a prototype, like the proposal's. The generated classes that implement them are
    // `MutexClass` and `ConditionClass`; their prototypes hold the operations that `Atomics.Mutex.lock` and the rest call.
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "Mutex"_s), JSC::JSFunction::create(vm, globalObject, 0, "Mutex"_s, Bun::callMutex, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, Bun::constructMutex));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "Condition"_s), JSC::JSFunction::create(vm, globalObject, 0, "Condition"_s, Bun::callCondition, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, Bun::constructCondition));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "MutexClass"_s), JSC::JSValue::decode(mutex));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "ConditionClass"_s), JSC::JSValue::decode(condition));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "SharedArray"_s), JSC::JSFunction::create(vm, globalObject, 0, "SharedArray"_s, Bun::callSharedArray, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, Bun::constructSharedArray));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "SharedStruct"_s), JSC::JSFunction::create(vm, globalObject, 1, "SharedStruct"_s, Bun::callSharedStruct, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, Bun::constructSharedStruct));
    return JSC::JSValue::encode(classes);
}
}
