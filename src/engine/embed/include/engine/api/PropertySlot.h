#pragma once

// What goes into and comes out of the internal methods of objects.

#include "engine/api/ExceptionScope.h"

namespace JSC {

enum class PropertyAttribute : unsigned {
    None = 0,
    ReadOnly = Engine::Attributes::READ_ONLY,
    DontEnum = Engine::Attributes::DONT_ENUM,
    DontDelete = Engine::Attributes::DONT_DELETE,
    Accessor = Engine::Attributes::ACCESSOR,
    CustomAccessor = Engine::Attributes::CUSTOM_ACCESSOR,
    CustomValue = Engine::Attributes::CUSTOM_VALUE,
    Function = Engine::Attributes::FUNCTION,
    Builtin = Engine::Attributes::BUILTIN,
    ConstantInteger = Engine::Attributes::CONSTANT_INTEGER,
    CellProperty = Engine::Attributes::CELL_PROPERTY,
    ClassStructure = Engine::Attributes::CLASS_STRUCTURE,
    PropertyCallback = Engine::Attributes::PROPERTY_CALLBACK,
    DOMAttribute = Engine::Attributes::DOM_ATTRIBUTE,
    Constructable = Engine::Attributes::CONSTRUCTABLE,
    CustomAccessorOrValue = CustomAccessor | CustomValue,
    AccessorOrCustomAccessorOrValue = Accessor | CustomAccessorOrValue,
    ReadOnlyOrAccessorOrCustomAccessorOrValue = ReadOnly | AccessorOrCustomAccessorOrValue,
    BuiltinOrFunction = Builtin | Function,
};

constexpr unsigned operator|(PropertyAttribute a, PropertyAttribute b) { return static_cast<unsigned>(a) | static_cast<unsigned>(b); }
constexpr unsigned operator|(unsigned a, PropertyAttribute b) { return a | static_cast<unsigned>(b); }
constexpr unsigned operator|(PropertyAttribute a, unsigned b) { return static_cast<unsigned>(a) | b; }
constexpr unsigned operator&(unsigned a, PropertyAttribute b) { return a & static_cast<unsigned>(b); }
constexpr unsigned operator~(PropertyAttribute a) { return ~static_cast<unsigned>(a); }
constexpr unsigned& operator|=(unsigned& a, PropertyAttribute b) { return a |= static_cast<unsigned>(b); }

class PropertySlot {
public:
    enum class InternalMethodType : uint8_t {
        Get = Engine::InternalMethod::Get,
        HasProperty = Engine::InternalMethod::HasProperty,
        GetOwnProperty = Engine::InternalMethod::GetOwnProperty,
        VMInquiry = Engine::InternalMethod::Inquiry,
    };

    ALWAYS_INLINE explicit PropertySlot(const JSValue thisValue, InternalMethodType method, VM* = nullptr)
        : m_thisValue(thisValue)
        , m_method(method)
    {
    }

    ALWAYS_INLINE JSValue getValue(JSGlobalObject* globalObject, PropertyName name) const { return isValue() ? m_value : Engine::slot_value(*this, globalObject, name); }
    JSValue getValue(JSGlobalObject* globalObject, uint64_t index) const { return isValue() ? m_value : Engine::slot_value_at_index(*this, globalObject, index); }
    // What the slot in the object has, or null if there is no such thing.
    JSValue getPureResult() const
    {
        if (m_isTaintedByOpaqueObject)
            return jsNull();
        if (isCacheableValue() || isCacheableGetter())
            return m_value;
        return isUnset() ? jsUndefined() : jsNull();
    }

    bool isUnset() const { return m_kind == Engine::SlotKind::Unset; }
    bool isValue() const { return m_kind == Engine::SlotKind::Value; }
    bool isAccessor() const { return m_kind == Engine::SlotKind::Getter; }
    bool isCustom() const { return m_kind == Engine::SlotKind::Custom; }
    bool isCacheableValue() const { return m_isCacheable && isValue(); }
    bool isCacheableGetter() const { return m_isCacheable && isAccessor(); }
    void disableCaching() { m_isCacheable = false; }
    bool isTaintedByOpaqueObject() const { return m_isTaintedByOpaqueObject; }
    void setIsTaintedByOpaqueObject() { m_isTaintedByOpaqueObject = true; }

    InternalMethodType internalMethodType() const { return m_method; }
    bool isVMInquiry() const { return m_method == InternalMethodType::VMInquiry; }
    unsigned attributes() const { return m_attributes; }
    JSObject* slotBase() const { return m_base; }
    JSValue thisValue() const { return m_thisValue; }
    void setThisValue(JSValue thisValue) { m_thisValue = thisValue; }
    GetterSetter* getterSetter() const { return reinterpret_cast<GetterSetter*>(m_value.asCell()); }

    void setValue(JSObject* base, unsigned attributes, JSValue value)
    {
        m_value = value;
        m_attributes = attributes;
        m_base = base;
        m_kind = Engine::SlotKind::Value;
    }

private:
    static void checkLayout();

    JSValue m_value;
    GetValueFunc m_customGetter;
    PutValueFunc m_customSetter;
    unsigned m_attributes { 0 };
    [[maybe_unused]] PropertyOffset m_offset { invalidOffset };
    JSValue m_thisValue;
    JSObject* m_base { nullptr };
    bool m_isCacheable { false };
    uint8_t m_kind { Engine::SlotKind::Unset };
    InternalMethodType m_method;
    [[maybe_unused]] uint8_t m_additionalDataKind { 0 };
    bool m_isTaintedByOpaqueObject { false };
    [[maybe_unused]] uint32_t m_scopeOffset { 0 };
    [[maybe_unused]] void* m_additionalData[2] {};
};

inline void PropertySlot::checkLayout()
{
    ENGINE_CHECK_SIZE(PropertySlot, sizeOfPropertySlot);
    ENGINE_CHECK_OFFSET(PropertySlot, m_value, PropertySlot_value);
    ENGINE_CHECK_OFFSET(PropertySlot, m_customGetter, PropertySlot_custom_getter);
    ENGINE_CHECK_OFFSET(PropertySlot, m_customSetter, PropertySlot_custom_setter);
    ENGINE_CHECK_OFFSET(PropertySlot, m_attributes, PropertySlot_attributes);
    ENGINE_CHECK_OFFSET(PropertySlot, m_offset, PropertySlot_offset);
    ENGINE_CHECK_OFFSET(PropertySlot, m_thisValue, PropertySlot_this_value);
    ENGINE_CHECK_OFFSET(PropertySlot, m_base, PropertySlot_base);
    ENGINE_CHECK_OFFSET(PropertySlot, m_isCacheable, PropertySlot_is_cacheable);
    ENGINE_CHECK_OFFSET(PropertySlot, m_kind, PropertySlot_kind);
    ENGINE_CHECK_OFFSET(PropertySlot, m_method, PropertySlot_method);
    ENGINE_CHECK_OFFSET(PropertySlot, m_additionalDataKind, PropertySlot_additional_data);
    ENGINE_CHECK_OFFSET(PropertySlot, m_isTaintedByOpaqueObject, PropertySlot_is_tainted_by_opaque_object);
}

class PutPropertySlot {
public:
    enum Type : uint8_t {
        Uncachable = Engine::PutKind::Uncacheable,
        ExistingProperty = Engine::PutKind::ExistingProperty,
        NewProperty = Engine::PutKind::NewProperty,
    };
    enum Context : uint8_t {
        UnknownContext = Engine::PutContext::Unknown,
        PutById = Engine::PutContext::PutById,
    };

    PutPropertySlot(JSValue thisValue, bool isStrictMode = false, Context context = UnknownContext, bool isInitialization = false)
        : m_thisValue(thisValue)
        , m_isStrictMode(isStrictMode)
        , m_isInitialization(isInitialization)
        , m_context(context)
    {
        ASSERT(thisValue);
    }

    Type type() const { return m_type; }
    JSValue thisValue() const { return m_thisValue; }
    void setThisValue(JSValue thisValue) { m_thisValue = thisValue; }
    bool isStrictMode() const { return m_isStrictMode; }
    void disableCaching() { m_isCacheable = false; }

private:
    static void checkLayout();

    [[maybe_unused]] JSObject* m_base { nullptr };
    JSValue m_thisValue;
    [[maybe_unused]] PropertyOffset m_offset { invalidOffset };
    bool m_isStrictMode;
    [[maybe_unused]] bool m_isInitialization;
    [[maybe_unused]] bool m_isTaintedByOpaqueObject { false };
    Type m_type { Uncachable };
    [[maybe_unused]] Context m_context;
    bool m_isCacheable { true };
    PutValueFunc m_customSetter;
};

inline void PutPropertySlot::checkLayout()
{
    ENGINE_CHECK_SIZE(PutPropertySlot, sizeOfPutPropertySlot);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_thisValue, PutPropertySlot_this_value);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_offset, PutPropertySlot_offset);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_isStrictMode, PutPropertySlot_is_strict);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_isInitialization, PutPropertySlot_is_initialization);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_isTaintedByOpaqueObject, PutPropertySlot_is_tainted_by_opaque_object);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_type, PutPropertySlot_kind);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_context, PutPropertySlot_context);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_isCacheable, PutPropertySlot_is_cacheable);
    ENGINE_CHECK_OFFSET(PutPropertySlot, m_customSetter, PutPropertySlot_custom_setter);
}

class DeletePropertySlot {
public:
    void disableCaching() { m_isCacheable = false; }

private:
    static void checkLayout();

    [[maybe_unused]] PropertyOffset m_offset { invalidOffset };
    bool m_isCacheable { true };
    [[maybe_unused]] uint8_t m_kind { Engine::DeleteKind::Uncacheable };
};

inline void DeletePropertySlot::checkLayout()
{
    ENGINE_CHECK_SIZE(DeletePropertySlot, sizeOfDeletePropertySlot);
    ENGINE_CHECK_OFFSET(DeletePropertySlot, m_isCacheable, DeletePropertySlot_is_cacheable);
    ENGINE_CHECK_OFFSET(DeletePropertySlot, m_kind, DeletePropertySlot_kind);
}

inline bool JSCell::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name)
{
    DeletePropertySlot slot;
    return cell->methodTable()->deleteProperty(cell, globalObject, name, slot);
}

class GetterSetter final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(GetterSetter)

    static GetterSetter* create(VM& vm, JSGlobalObject*, JSObject* getter, JSObject* setter) { return Engine::getter_setter_create(vm, getter, setter); }
    static GetterSetter* create(VM& vm, JSGlobalObject*, JSValue getter, JSValue setter) { return Engine::getter_setter_create(vm, getter ? getter.getObject() : nullptr, setter ? setter.getObject() : nullptr); }

    JSObject* getter() const { return Engine::fieldAt<JSObject*>(this, Engine::Layout::GetterSetter_getter); }
    JSObject* setter() const { return Engine::fieldAt<JSObject*>(this, Engine::Layout::GetterSetter_setter); }
    bool isGetterNull() const { return !getter(); }
    bool isSetterNull() const { return !setter(); }
    JSValue callGetter(JSGlobalObject* globalObject, JSValue thisValue) { return Engine::getter_setter_call_getter(this, globalObject, thisValue); }
};
ENGINE_CLASS_HAS_TYPE(GetterSetter, GetterSetterType);

class CustomGetterSetter : public JSCell {
public:
    using CustomGetter = GetValueFunc;
    using CustomSetter = PutValueFunc;

    ENGINE_DECLARE_CLASS(CustomGetterSetter)

    static CustomGetterSetter* create(VM& vm, CustomGetter getter, CustomSetter setter) { return Engine::custom_getter_setter_create(vm, getter, setter, nullptr); }

    CustomGetter getter() const { return Engine::fieldAt<CustomGetter>(this, Engine::Layout::CustomGetterSetter_getter); }
    CustomSetter setter() const { return Engine::fieldAt<CustomSetter>(this, Engine::Layout::CustomGetterSetter_setter); }
};
ENGINE_CLASS_HAS_TYPE(CustomGetterSetter, CustomGetterSetterType);

struct DOMAttributeAnnotation {
    const ClassInfo* classInfo;
    const void* unused;
};

// Its getter is called only with an instance of the class.
class DOMAttributeGetterSetter final : public CustomGetterSetter {
public:
    static DOMAttributeGetterSetter* create(VM& vm, CustomGetter getter, CustomSetter setter, DOMAttributeAnnotation annotation) { return static_cast<DOMAttributeGetterSetter*>(Engine::custom_getter_setter_create(vm, getter, setter, annotation.classInfo)); }
};

class PropertyDescriptor {
public:
    PropertyDescriptor() = default;
    PropertyDescriptor(JSValue value, unsigned attributes)
        : m_value(value)
        , m_attributes(attributes)
        , m_present(Engine::Present::WRITABLE | Engine::Present::ENUMERABLE | Engine::Present::CONFIGURABLE)
    {
    }

    unsigned attributes() const { return m_attributes; }
    bool writable() const { return !(m_attributes & PropertyAttribute::ReadOnly); }
    bool enumerable() const { return !(m_attributes & PropertyAttribute::DontEnum); }
    bool configurable() const { return !(m_attributes & PropertyAttribute::DontDelete); }
    bool writablePresent() const { return m_present & Engine::Present::WRITABLE; }
    bool enumerablePresent() const { return m_present & Engine::Present::ENUMERABLE; }
    bool configurablePresent() const { return m_present & Engine::Present::CONFIGURABLE; }
    bool isDataDescriptor() const { return m_value || writablePresent(); }
    bool isAccessorDescriptor() const { return m_getter || m_setter; }
    JSValue value() const { return m_value; }
    JSValue getter() const { return m_getter; }
    JSValue setter() const { return m_setter; }

    void setValue(JSValue value) { m_value = value; }
    void setWritable(bool writable) { set(PropertyAttribute::ReadOnly, !writable, Engine::Present::WRITABLE); }
    void setEnumerable(bool enumerable) { set(PropertyAttribute::DontEnum, !enumerable, Engine::Present::ENUMERABLE); }
    void setConfigurable(bool configurable) { set(PropertyAttribute::DontDelete, !configurable, Engine::Present::CONFIGURABLE); }
    void setGetter(JSValue getter)
    {
        m_getter = getter;
        m_attributes = (m_attributes | PropertyAttribute::Accessor) & ~PropertyAttribute::ReadOnly;
    }
    void setSetter(JSValue setter)
    {
        m_setter = setter;
        m_attributes = (m_attributes | PropertyAttribute::Accessor) & ~PropertyAttribute::ReadOnly;
    }
    // Of what the slot of a property has.
    void setDescriptor(JSValue value, unsigned attributes) { Engine::descriptor_of_stored(*this, value, attributes); }
    void setAccessorDescriptor(GetterSetter* accessor, unsigned attributes) { setDescriptor(accessor, attributes); }

private:
    static void checkLayout();

    void set(PropertyAttribute attribute, bool value, unsigned present)
    {
        m_attributes = value ? m_attributes | attribute : m_attributes & ~attribute;
        m_present |= present;
    }

    JSValue m_value;
    JSValue m_getter;
    JSValue m_setter;
    unsigned m_attributes { Engine::Attributes::CONSTANT };
    unsigned m_present { 0 };
};

inline void PropertyDescriptor::checkLayout()
{
    ENGINE_CHECK_SIZE(PropertyDescriptor, sizeOfPropertyDescriptor);
    ENGINE_CHECK_OFFSET(PropertyDescriptor, m_getter, PropertyDescriptor_getter);
    ENGINE_CHECK_OFFSET(PropertyDescriptor, m_setter, PropertyDescriptor_setter);
    ENGINE_CHECK_OFFSET(PropertyDescriptor, m_attributes, PropertyDescriptor_attributes);
    ENGINE_CHECK_OFFSET(PropertyDescriptor, m_present, PropertyDescriptor_present);
}

class PropertyNameArray : public RefCounted<PropertyNameArray> {
public:
    using PropertyNameVector = Vector<Identifier>;

    PropertyNameVector& propertyNameVector() { return m_names; }

private:
    PropertyNameVector m_names;
};

// Collects keys of the kinds that it was asked for, each once.
class PropertyNameArrayBuilder {
    WTF_MAKE_NONCOPYABLE(PropertyNameArrayBuilder);

public:
    PropertyNameArrayBuilder(VM&, PropertyNameMode mode, PrivateSymbolMode privateSymbolMode) { Engine::name_list_construct(this, mode, privateSymbolMode == PrivateSymbolMode::Include); }
    PropertyNameArrayBuilder(PropertyNameArrayBuilder&& other) { Engine::name_list_take(this, other); }
    ~PropertyNameArrayBuilder() { Engine::name_list_destroy(this); }

    void add(PropertyName name) { Engine::name_list_add(*this, name); }
    void clear() { Engine::name_list_clear(*this); }

    size_t size() const { return Engine::name_list_length(*this); }
    Identifier* begin() const { return reinterpret_cast<Identifier*>(Engine::name_list_first(*this)); }
    Identifier* end() const { return begin() + size(); }
    Identifier& operator[](unsigned index) const
    {
        RELEASE_ASSERT(index < size());
        return begin()[index];
    }

    RefPtr<PropertyNameArray> releaseData()
    {
        auto array = adoptRef(*new PropertyNameArray);
        array->propertyNameVector().append(std::span<const Identifier>(begin(), size()));
        clear();
        return array;
    }

private:
    [[maybe_unused]] Engine::Opaque<Engine::Layout::propertyNameListSize> m_list;
};

} // namespace JSC
