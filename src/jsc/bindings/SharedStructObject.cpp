// `SharedStruct` and `SharedArray`: JS views over the atomic slots of a Rust `SharedBlock` (src/shared_struct).
//
// The views are exotic objects, like process.env (JSEnvironmentVariableMap.cpp): a property is a slot, found by name or by index,
// and a read or write goes to Rust, which converts between a JSValue and what a slot holds. Mutex and Condition are not here: they
// are ordinary generated classes (src/shared_struct_jsc/shared_struct_classes.bind.ts).

#include "SharedStructObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>

// Rust, in src/shared_struct_jsc/shared_struct_classes.rs.
extern "C" {
// A new block, or null with an exception pending.
const void* Bun__SharedStruct__newBlock(JSC::JSGlobalObject*, JSC::EncodedJSValue names);
const void* Bun__SharedArray__newBlock(JSC::JSGlobalObject*, JSC::EncodedJSValue length);
}

// Defined at the end of this file, which is also where Rust calls them.
extern "C" JSC::EncodedJSValue Bun__SharedBlock__wrap(JSC::JSGlobalObject*, const void* block);

namespace Bun {
using namespace JSC;

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
    // The constructor sizes the cache under this lock, and a collection can find the cell before the constructor is done.
    WTF::Locker locker { thisObject->cellLock() };
    for (auto& entry : thisObject->m_cache)
        visitor.append(entry.wrapper);
}

DEFINE_VISIT_CHILDREN(JSSharedView);

void JSSharedView::remember(VM& vm, size_t index, const void* key, JSObject* object)
{
    SlotCache& entry = m_cache[index];
    if (key && object) {
        if (object != entry.wrapper.get())
            entry.wrapper.set(vm, this, object);
        entry.key = key;
    } else {
        entry.wrapper.clear();
        entry.key = nullptr;
    }
}

JSObject* JSSharedView::cachedWrapper(size_t index, const void* key) const
{
    const SlotCache& entry = m_cache[index];
    return key && entry.key == key ? entry.wrapper.get() : nullptr;
}

JSValue JSSharedView::load(JSGlobalObject* globalObject, size_t index)
{
    VM& vm = getVM(globalObject);
    SlotCache& entry = m_cache[index];
    const void* key = nullptr;
    // Rust hands back the cached wrapper when the slot still holds the object behind it.
    JSValue value = JSValue::decode(Bun__SharedBlock__load(m_block, index, globalObject, entry.key, JSValue::encode(JSValue(entry.wrapper.get())), &key));
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
    if (descriptor.isAccessorDescriptor()
        || (descriptor.configurablePresent() && descriptor.configurable())
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

bool JSSharedStruct::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(cell);
    // A write through an object that inherits from this one is that object's own.
    if (slot.thisValue() == cell) {
        if (auto index = self->slotOf(propertyName))
            return self->store(globalObject, *index, value);
    }
    // Not extensible: this refuses a name that is not a field, as it does for any frozen-shaped object.
    return Base::put(cell, globalObject, propertyName, value, slot);
}

bool JSSharedStruct::defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(object);
    if (auto index = self->slotOf(propertyName))
        return self->redefineSlot(globalObject, *index, descriptor, shouldThrow);
    return Base::defineOwnProperty(object, globalObject, propertyName, descriptor, shouldThrow);
}

bool JSSharedStruct::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(cell);
    if (self->slotOf(propertyName))
        return false;
    return Base::deleteProperty(cell, globalObject, propertyName, slot);
}

void JSSharedStruct::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    auto* self = uncheckedDowncast<JSSharedStruct>(object);
    for (const auto& name : self->m_names)
        names.add(name);
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
    // A write through an object that inherits from this one is that object's own.
    if (slot.thisValue() == cell) {
        if (auto index = parseIndex(propertyName))
            return putByIndex(cell, globalObject, *index, value, slot.isStrictMode());
    }
    return Base::put(cell, globalObject, propertyName, value, slot);
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

bool JSSharedArray::deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index)
{
    auto* self = uncheckedDowncast<JSSharedArray>(cell);
    if (index < self->m_length)
        return false;
    return Base::deletePropertyByIndex(cell, globalObject, index);
}

bool JSSharedArray::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    VM& vm = getVM(globalObject);
    if (propertyName == vm.propertyNames->length)
        return false;
    // Delegate an index to deletePropertyByIndex: JSObject's named form re-dispatches an index back here.
    if (auto index = parseIndex(propertyName))
        return deletePropertyByIndex(cell, globalObject, *index);
    return Base::deleteProperty(cell, globalObject, propertyName, slot);
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

}

extern "C" {

// A new view of `block`, in the realm of `globalObject`. Takes the caller's strong count of `block`.
JSC::EncodedJSValue Bun__SharedBlock__wrap(JSC::JSGlobalObject* globalObject, const void* block)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSObject* view;
    if (Bun__SharedBlock__isStruct(block))
        view = Bun::JSSharedStruct::create(vm, globalObject, block);
    else
        view = Bun::JSSharedArray::create(vm, globalObject, block);
    view->methodTable()->preventExtensions(view, globalObject);
    return JSC::JSValue::encode(view);
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
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "Mutex"_s), JSC::JSValue::decode(mutex));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "Condition"_s), JSC::JSValue::decode(condition));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "SharedArray"_s), JSC::JSFunction::create(vm, globalObject, 0, "SharedArray"_s, Bun::callSharedArray, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, Bun::constructSharedArray));
    classes->putDirect(vm, JSC::Identifier::fromString(vm, "SharedStruct"_s), JSC::JSFunction::create(vm, globalObject, 1, "SharedStruct"_s, Bun::callSharedStruct, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, Bun::constructSharedStruct));
    return JSC::JSValue::encode(classes);
}
}
