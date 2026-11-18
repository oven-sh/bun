#pragma once

// What objects with the same class, prototype and properties share, and the memory of an object outside its cell.

#include "engine/api/PropertySlot.h"

namespace JSC {

class PropertyTableEntry {
public:
    UniquedStringImpl* key() const { return m_key; }
    PropertyOffset offset() const { return m_offset; }
    uint8_t attributes() const { return m_attributes; }

private:
    static void checkLayout();

    UniquedStringImpl* m_key;
    PropertyOffset m_offset;
    unsigned m_attributes;
};

inline void PropertyTableEntry::checkLayout()
{
    ENGINE_CHECK_SIZE(PropertyTableEntry, sizeOfPropertyEntry);
    ENGINE_CHECK_OFFSET(PropertyTableEntry, m_offset, PropertyEntry_offset);
    ENGINE_CHECK_OFFSET(PropertyTableEntry, m_attributes, PropertyEntry_attributes);
}

class Structure final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(Shape)

    static constexpr int s_maxTransitionLengthForNonEvalPutById = Engine::Layout::maxTransitionsByPutById;

    struct PropertyHashEntry {
        const HashTable* table;
        const HashTableValue* value;
    };

    static Structure* create(VM& vm, JSGlobalObject* globalObject, JSValue prototype, const TypeInfo& typeInfo, const ClassInfo* classInfo, IndexingType indexingType = NonArray, unsigned inlineCapacity = 0)
    {
        auto* structure = Engine::shape_create(vm, globalObject, prototype, typeInfo.type(), typeInfo.flags(), classInfo, indexingType & ~MayHaveIndexedAccessors, inlineCapacity);
        if (indexingType & MayHaveIndexedAccessors)
            structure->flags() |= Engine::ShapeFlags::MAY_HAVE_INDEXED_ACCESSORS;
#if ASSERT_ENABLED
        structure->assertThatTypeInfoSuitsClass();
#endif
        return structure;
    }
    // For objects that are yet to be made.
    static Structure* addPropertyTransition(VM& vm, Structure* structure, PropertyName name, unsigned attributes, PropertyOffset& offset) { return Engine::shape_add_property_transition(structure, vm, name, attributes, offset); }

    StructureID id() const { return StructureID::encode(this); }
    TypeInfo typeInfo() const { return TypeInfo(static_cast<JSType>(header() >> 8 & 0xff), (header() >> 16 & 0xff) | Engine::fieldAt<uint16_t>(this, Engine::Layout::Shape_out_of_line_type_flags) << 8); }
    IndexingType indexingType() const { return indexingTypeOfHeader(header()); }
    const ClassInfo* classInfoForCells() const { return Engine::fieldAt<const ClassInfo*>(this, Engine::Layout::Shape_instance_class); }
    JSGlobalObject* realm() const { return Engine::fieldAt<JSGlobalObject*>(this, Engine::Layout::Shape_global); }
    JSGlobalObject* globalObject() const { return realm(); }
    JSValue storedPrototype(const JSObject* = nullptr) const { return Engine::fieldAt<JSValue>(this, Engine::Layout::Shape_stored_prototype); }
    JSObject* storedPrototypeObject() const { return storedPrototype().isCell() ? reinterpret_cast<JSObject*>(storedPrototype().asCell()) : nullptr; }
    constexpr bool hasMonoProto() const { return true; }
    constexpr bool hasPolyProto() const { return false; }
    constexpr bool isBrandedStructure() const { return false; }
    constexpr bool isCompiledStructure() const { return false; }

    PropertyOffset maxOffset() const { return Engine::fieldAt<PropertyOffset>(this, Engine::Layout::Shape_max_offset); }
    unsigned inlineCapacity() const { return Engine::fieldAt<uint8_t>(this, Engine::Layout::Shape_inline_capacity); }
    unsigned inlineSize() const { return std::min<unsigned>(maxOffset() + 1, inlineCapacity()); }
    unsigned outOfLineSize() const { return isInlineOffset(maxOffset()) ? 0 : maxOffset() - firstOutOfLineOffset + 1; }
    unsigned outOfLineCapacity() const { return outOfLineSize() ? std::max<unsigned>(std::bit_ceil(outOfLineSize()), Engine::Layout::initialOutOfLineCapacity) : 0; }
    bool isValidOffset(PropertyOffset offset) const { return JSC::isValidOffset(offset) && offset <= maxOffset() && (!isInlineOffset(offset) || offset < static_cast<int>(inlineCapacity())); }

    bool isDictionary() const { return flags() & Engine::ShapeFlags::DICTIONARY; }
    bool isUncacheableDictionary() const { return flags() & Engine::ShapeFlags::UNCACHEABLE_DICTIONARY; }
    bool isStructureExtensible() const { return !(flags() & Engine::ShapeFlags::DID_PREVENT_EXTENSIONS); }
    bool mayBePrototype() const { return flags() & Engine::ShapeFlags::MAY_BE_PROTOTYPE; }
    bool hasAnyKindOfGetterSetterProperties() const { return flags() & Engine::ShapeFlags::HAS_ANY_ACCESSOR; }
    bool hasNonEnumerableProperties() const { return flags() & Engine::ShapeFlags::HAS_NON_ENUMERABLE; }
    bool hasNonConfigurableProperties() const { return flags() & Engine::ShapeFlags::HAS_NON_CONFIGURABLE; }
    bool hasUnderscoreProtoPropertyExcludingOriginalProto() const { return flags() & Engine::ShapeFlags::HAS_UNDERSCORE_PROTO; }
    bool staticPropertiesReified() const { return flags() & Engine::ShapeFlags::STATIC_PROPERTIES_REIFIED; }
    bool hasNonReifiedStaticProperties() const { return typeInfo().hasStaticPropertyTable() && !staticPropertiesReified(); }
    bool canAccessPropertiesQuicklyForEnumeration() const
    {
        return !(flags() & (Engine::ShapeFlags::PREVENTS_QUICK_ENUMERATION | Engine::ShapeFlags::HAS_ANY_ACCESSOR | Engine::ShapeFlags::UNCACHEABLE_DICTIONARY)) && !typeInfo().overridesGetOwnPropertyNames();
    }
    // The table has all own properties, and reading them runs no code.
    bool canPerformFastPropertyEnumeration() const
    {
        return !(typeInfo().flags() & (OverridesGetOwnPropertySlot | OverridesGetOwnPropertyNames | OverridesGetOwnSpecialPropertyNames))
            && !(flags() & (Engine::ShapeFlags::HAS_ANY_ACCESSOR | Engine::ShapeFlags::UNCACHEABLE_DICTIONARY | Engine::ShapeFlags::HAS_UNDERSCORE_PROTO))
            && !hasIndexedProperties(indexingType()) && !hasNonReifiedStaticProperties();
    }
    bool holesMustForwardToPrototype(JSObject* object) const { return Engine::object_holes_must_forward_to_prototype(object); }

    void setMayBePrototype(bool value) { set(Engine::ShapeFlags::MAY_BE_PROTOTYPE, value); }
    void setTransitionWatchpointIsLikelyToBeFired(bool value) { set(Engine::ShapeFlags::TRANSITION_IS_LIKELY, value); }
    void setContainsReadOnlyProperties() { set(Engine::ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO, true); }
    void setHasAnyKindOfGetterSetterPropertiesWithProtoCheck(bool isUnderscoreProto) { set(Engine::ShapeFlags::HAS_ANY_ACCESSOR | (isUnderscoreProto ? 0 : Engine::ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO), true); }

    // True if it has never had the property.
    ALWAYS_INLINE bool rulesOut(PropertyName name) const { return !name.uid() || reinterpret_cast<uintptr_t>(name.uid()) & ~Engine::fieldAt<uintptr_t>(this, Engine::Layout::Shape_seen_names); }
    ALWAYS_INLINE PropertyOffset get(VM&, PropertyName name, unsigned& attributes) const { return rulesOut(name) ? invalidOffset : Engine::shape_get(this, name, attributes); }
    ALWAYS_INLINE PropertyOffset get(VM& vm, PropertyName name) const
    {
        unsigned attributes;
        return get(vm, name, attributes);
    }
    PropertyOffset getConcurrently(UniquedStringImpl* name, unsigned& attributes) const { return Engine::shape_get(this, name, attributes); }
    std::optional<PropertyHashEntry> findPropertyHashEntry(PropertyName) const;

    // Those that it has now, until the functor returns false.
    template<typename Functor> void forEachProperty(VM&, const Functor& functor)
    {
        const PropertyTableEntry* entry;
        size_t count;
        const void* properties = Engine::shape_retain_properties(this, entry, count);
        for (const auto* end = entry + count; entry != end; ++entry) {
            if (entry->key() && !functor(*entry))
                break;
        }
        Engine::release_properties(properties);
    }

    void didReplaceProperty(PropertyOffset offset)
    {
        if (flags() & Engine::ShapeFlags::IS_WATCHING_REPLACEMENT) [[unlikely]]
            Engine::shape_did_replace_property(this, vm(), offset);
    }

private:
    void assertThatTypeInfoSuitsClass() const;
    uint32_t header() const { return Engine::fieldAt<uint32_t>(this, Engine::Layout::Shape_instance_header); }
    uint32_t& flags() const { return Engine::fieldAt<uint32_t>(this, Engine::Layout::Shape_flags); }
    void set(uint32_t flag, bool value) { flags() = value ? flags() | flag : flags() & ~flag; }
};
ENGINE_CLASS_HAS_TYPE(Structure, StructureType);

class StructureCache {
public:
    Structure* emptyObjectStructureForPrototype(JSGlobalObject* globalObject, JSObject* prototype, unsigned inlineCapacity) { return Engine::shape_for_empty_object(globalObject, prototype, inlineCapacity); }
};

inline bool JSCell::canUseFastGetOwnProperty(const Structure& structure)
{
    return !structure.hasAnyKindOfGetterSetterProperties() && !structure.typeInfo().overridesGetOwnPropertySlot();
}

template<typename T> class ContiguousData {
public:
    explicit ContiguousData(T* data)
        : m_data(data)
    {
    }

    T& at(const JSCell*, size_t index) const { return m_data[index]; }
    T& atUnsafe(size_t index) const { return m_data[index]; }
    T* data() const { return m_data; }

private:
    T* m_data;
};

using ContiguousDoubles = ContiguousData<double>;
using ContiguousJSValues = ContiguousData<WriteBarrier<Unknown>>;
using PropertyStorage = WriteBarrierBase<Unknown>*;

// Has the address of element 0. Before it are the lengths, and before those the properties that are not in the cell.
class Butterfly {
    WTF_MAKE_NONCOPYABLE(Butterfly);

public:
    // What a new object with that structure needs.
    static Butterfly* create(VM& vm, Structure* structure) { return Engine::storage_create(vm, structure); }

    uint32_t publicLength() const { return Engine::fieldAt<uint32_t>(this, -Engine::Layout::publicLengthBelowStorage); }
    uint32_t vectorLength() const { return Engine::fieldAt<uint32_t>(this, -Engine::Layout::vectorLengthBelowStorage); }
    void setPublicLength(uint32_t length) { __atomic_store_n(&Engine::fieldAt<uint32_t>(this, -Engine::Layout::publicLengthBelowStorage), length, __ATOMIC_RELAXED); }

    ContiguousJSValues contiguous() const { return ContiguousJSValues(&Engine::fieldAt<WriteBarrier<Unknown>>(this, 0)); }
    ContiguousDoubles contiguousDouble() const { return ContiguousDoubles(&Engine::fieldAt<double>(this, 0)); }
    WriteBarrierBase<Unknown>* outOfLineSlot(PropertyOffset offset) const { return contiguous().data() + (firstOutOfLineOffset - 2 - offset); }
};

} // namespace JSC
