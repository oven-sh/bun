#pragma once

// Properties and fields that get their value when they are first used.

#include "engine/api/Function.h"

namespace JSC {

template<typename OwnerType, typename ElementType>
class LazyProperty {
public:
    struct Initializer {
        void set(ElementType* value) const { property.set(vm, owner, value); }

        VM& vm;
        OwnerType* owner;
        LazyProperty& property;
    };

    // `function` has no state.
    template<typename Functor> void initLater(const Functor&)
    {
        static_assert(std::is_empty_v<Functor>);
        static constexpr Initialize initialize = &call<Functor>;
        m_pointer = isLazy | reinterpret_cast<uintptr_t>(&initialize);
    }

    void set(VM& vm, const OwnerType* owner, ElementType* value)
    {
        RELEASE_ASSERT(value);
        __atomic_store_n(&m_pointer, reinterpret_cast<uintptr_t>(value), __ATOMIC_RELAXED);
        vm.writeBarrier(owner);
    }

    ALWAYS_INLINE ElementType* getInitializedOnMainThread(const OwnerType* owner) const
    {
        if (m_pointer & isLazy) [[unlikely]]
            return (*reinterpret_cast<const Initialize*>(m_pointer & ~tags))({ owner->vm(), const_cast<OwnerType*>(owner), *const_cast<LazyProperty*>(this) });
        return reinterpret_cast<ElementType*>(m_pointer);
    }
    ALWAYS_INLINE ElementType* get(const OwnerType* owner) const { return getInitializedOnMainThread(owner); }
    ElementType* getConcurrently() const
    {
        uintptr_t pointer = __atomic_load_n(&m_pointer, __ATOMIC_RELAXED);
        return pointer & isLazy ? nullptr : reinterpret_cast<ElementType*>(pointer);
    }
    bool isInitialized() const { return !(m_pointer & isLazy); }

    template<typename Visitor> void visit(Visitor& visitor) { visitor.appendUnbarriered(reinterpret_cast<JSCell*>(getConcurrently())); }

private:
    using Initialize = ElementType* (*)(const Initializer&);

    static constexpr uintptr_t isLazy = 1;
    static constexpr uintptr_t isInitializing = 2;
    static constexpr uintptr_t tags = isLazy | isInitializing;

    template<typename Functor> static ElementType* call(const Initializer& initializer)
    {
        uintptr_t& pointer = initializer.property.m_pointer;
        if (pointer & isInitializing)
            return nullptr;
        DeferTerminationForAWhile deferTermination(initializer.vm);
        pointer |= isInitializing;
        Functor {}(initializer);
        RELEASE_ASSERT(!(pointer & tags));
        return reinterpret_cast<ElementType*>(pointer);
    }

    uintptr_t m_pointer { 0 };
};

using LazyCellProperty = LazyProperty<JSCell, JSCell>;

class LazyClassStructure {
    using StructureInitializer = LazyProperty<JSGlobalObject, Structure>::Initializer;

public:
    struct Initializer {
        // In this order. The prototype defaults to that of the structure.
        void setPrototype(JSObject*);
        void setStructure(Structure*);
        void setConstructor(JSObject*);

        VM& vm;
        JSGlobalObject* global;
        LazyClassStructure& classStructure;
        const StructureInitializer& structureInit;
        JSObject* prototype { nullptr };
        Structure* structure { nullptr };
        JSObject* constructor { nullptr };
    };

    template<typename Functor> void initLater(const Functor&)
    {
        m_structure.initLater([](const StructureInitializer& init) {
            Initializer initializer { init.vm, init.owner, *reinterpret_cast<LazyClassStructure*>(&init.property), init };
            Functor {}(initializer);
        });
    }

    Structure* get(const JSGlobalObject*) const;
    JSObject* prototype(const JSGlobalObject* global) const { return get(global)->storedPrototypeObject(); }
    JSObject* constructor(const JSGlobalObject* global) const
    {
        get(global);
        return m_constructor.get();
    }
    Structure* getInitializedOnMainThread(const JSGlobalObject* global) const { return get(global); }
    JSObject* prototypeInitializedOnMainThread(const JSGlobalObject* global) const { return prototype(global); }
    JSObject* constructorInitializedOnMainThread(const JSGlobalObject* global) const { return constructor(global); }

    template<typename Visitor> void visit(Visitor& visitor)
    {
        m_structure.visit(visitor);
        visitor.append(m_constructor);
    }

private:
    static void checkLayout();

    LazyProperty<JSGlobalObject, Structure> m_structure;
    WriteBarrier<JSObject> m_constructor;
};

inline void LazyClassStructure::checkLayout()
{
    ENGINE_CHECK_SIZE(LazyClassStructure, sizeOfLazyClass);
    ENGINE_CHECK_OFFSET(LazyClassStructure, m_constructor, LazyClass_constructor);
}

using BuiltinGenerator = BuiltinCode (*)(VM&);
using LazyPropertyCallback = JSValue (*)(VM&, JSObject*);

struct CompactHashIndex {
    const int16_t value;
    const int16_t next;
};
ENGINE_CHECK_SIZE(CompactHashIndex, sizeOfStaticIndex);

// The attributes say what the two words are.
struct HashTableValue {
    enum BuiltinAccessorTypeTag { BuiltinAccessorType };
    enum BuiltinGeneratorTypeTag { BuiltinGeneratorType };
    enum ConstantTypeTag { ConstantType };
    enum GetterSetterTypeTag { GetterSetterType };
    enum LazyCellPropertyTypeTag { LazyCellPropertyType };
    enum LazyClassStructureTypeTag { LazyClassStructureType };
    enum LazyPropertyTypeTag { LazyPropertyType };
    enum NativeFunctionTypeTag { NativeFunctionType };

    struct ValueStorage {
        constexpr ValueStorage(BuiltinAccessorTypeTag, BuiltinGenerator getter, BuiltinGenerator setter)
            : first { .generator = getter }
            , second { .generator = setter }
        {
        }
        constexpr ValueStorage(BuiltinGeneratorTypeTag, BuiltinGenerator generator, intptr_t length)
            : first { .generator = generator }
            , second { .integer = length }
        {
        }
        constexpr ValueStorage(ConstantTypeTag, long long constant)
            : first { .integer = constant }
        {
        }
        constexpr ValueStorage(GetterSetterTypeTag, GetValueFunc::Ptr getter, PutValueFunc::Ptr setter)
            : first { .getter = getter }
            , second { .setter = setter }
        {
        }
        constexpr ValueStorage(LazyCellPropertyTypeTag, ptrdiff_t offset)
            : first { .integer = offset }
        {
        }
        constexpr ValueStorage(LazyClassStructureTypeTag, ptrdiff_t offset)
            : first { .integer = offset }
        {
        }
        constexpr ValueStorage(LazyPropertyTypeTag, LazyPropertyCallback callback)
            : first { .callback = callback }
        {
        }
        constexpr ValueStorage(NativeFunctionTypeTag, NativeFunction::Ptr function, intptr_t length)
            : first { .function = function }
            , second { .integer = length }
        {
        }

        union Word {
            int64_t integer;
            BuiltinGenerator generator;
            GetValueFunc::Ptr getter;
            PutValueFunc::Ptr setter;
            LazyPropertyCallback callback;
            NativeFunction::Ptr function;
        };

        Word first;
        Word second { .integer = 0 };
    };

    unsigned attributes() const { return m_attributes; }
    Intrinsic intrinsic() const { return m_intrinsic; }
    NativeFunction function() const { return m_values.first.function; }
    unsigned char functionLength() const { return m_values.second.integer; }
    ptrdiff_t lazyCellPropertyOffset() const { return m_values.first.integer; }
    ptrdiff_t lazyClassStructureOffset() const { return m_values.first.integer; }
    LazyPropertyCallback lazyPropertyCallback() const { return m_values.first.callback; }

    ASCIILiteral m_key;
    unsigned m_attributes;
    Intrinsic m_intrinsic;
    ValueStorage m_values;
};
ENGINE_CHECK_SIZE(HashTableValue, sizeOfStaticProperty);
ENGINE_CHECK_OFFSET(HashTableValue, m_attributes, StaticProperty_attributes);
ENGINE_CHECK_OFFSET(HashTableValue, m_intrinsic, StaticProperty_intrinsic);
ENGINE_CHECK_OFFSET(HashTableValue, m_values, StaticProperty_first);

// The properties that the instances of a class start with.
struct HashTable {
    const HashTableValue* entry(PropertyName name) const { return Engine::static_table_find(*this, name); }
    const HashTableValue* begin() const { return values; }
    const HashTableValue* end() const { return values + numberOfValues; }

    int numberOfValues;
    int indexMask;
    uint8_t unused;
    const ClassInfo* classForThis;
    const HashTableValue* values;
    const CompactHashIndex* index;
};
ENGINE_CHECK_SIZE(HashTable, sizeOfStaticTable);
ENGINE_CHECK_OFFSET(HashTable, indexMask, StaticTable_index_mask);
ENGINE_CHECK_OFFSET(HashTable, unused, StaticTable_seen_attributes);
ENGINE_CHECK_OFFSET(HashTable, classForThis, StaticTable_class_for_this);
ENGINE_CHECK_OFFSET(HashTable, values, StaticTable_values);
ENGINE_CHECK_OFFSET(HashTable, index, StaticTable_index);

inline std::optional<Structure::PropertyHashEntry> Structure::findPropertyHashEntry(PropertyName name) const
{
    for (const ClassInfo* info = classInfoForCells(); info; info = info->parentClass) {
        if (const HashTable* table = info->staticPropHashTable) {
            if (const HashTableValue* value = table->entry(name))
                return PropertyHashEntry { table, value };
        }
    }
    return std::nullopt;
}

inline void reifyStaticProperties(VM&, const ClassInfo* classForThis, std::span<const HashTableValue> values, JSObject& object) { Engine::object_reify_entries(&object, classForThis, values); }

} // namespace JSC
