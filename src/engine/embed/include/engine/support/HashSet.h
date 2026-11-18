#pragma once

#include "engine/support/HashFunctions.h"
#include "engine/support/HashTable.h"
#include "engine/support/HashTraits.h"

#include <initializer_list>

namespace WTF {

template<typename T, typename Hash, typename Traits>
class HashSet final {
    WTF_MAKE_TZONE_ALLOCATED(HashSet);

public:
    using ValueType = typename Traits::TraitType;
    using iterator = Detail::HashTableIterator<const ValueType>;
    using const_iterator = iterator;
    using AddResult = Detail::HashTableAddResult<iterator>;

private:
    using TakeType = typename Traits::TakeType;
    template<typename V> using RawPointer = const typename GetPtrHelper<V>::UnderlyingType*;

public:
    HashSet() = default;

    HashSet(std::initializer_list<T> values)
    {
        if (!values.size())
            return;
        reserveInitialCapacity(values.size());
        for (auto& value : values)
            add(value);
    }

    void swap(HashSet& other) { m_table.swap(other.m_table); }

    unsigned size() const { return m_table.size(); }
    unsigned capacity() const { return m_table.capacity(); }
    bool isEmpty() const { return m_table.isEmpty(); }

    void reserveInitialCapacity(unsigned keyCount) { m_table.reserveInitialCapacity(keyCount); }

    iterator begin() const LIFETIME_BOUND { return m_table.begin(); }
    iterator end() const LIFETIME_BOUND { return {}; }

    ALWAYS_INLINE iterator find(const ValueType& value) const LIFETIME_BOUND { return find<Hash>(value); }
    bool contains(const ValueType& value) const { return contains<Hash>(value); }

    ALWAYS_INLINE AddResult add(const ValueType& value) LIFETIME_BOUND { return addResult(insert(value)); }
    ALWAYS_INLINE AddResult add(ValueType&& value) LIFETIME_BOUND { return addResult(insert(WTF::move(value))); }
    void addVoid(const ValueType& value) { insert(value); }
    void addVoid(ValueType&& value) { insert(WTF::move(value)); }

    bool remove(const ValueType& value) { return removeEntry(lookup<Hash>(value)); }
    bool remove(iterator position) { return removeEntry(entryAt(position)); }
    bool removeIf(const Invocable<bool(const ValueType&)> auto& matches) { return m_table.removeIf(matches); }
    void clear() { m_table.clear(); }

    TakeType take(const ValueType& value) { return takeEntry(lookup<Hash>(value)); }
    TakeType take(iterator position) { return takeEntry(entryAt(position)); }
    TakeType takeAny() { return take(begin()); }

    // By a value of another type. The translator has hash(value), equal(element, value) and, to add,
    // translate(slot, value, hash), which constructs the element.
    template<typename Translator, typename U> ALWAYS_INLINE iterator find(const U& value) const LIFETIME_BOUND { return m_table.iteratorAt(lookup<Translator>(value)); }
    template<typename Translator, typename U> bool contains(const U& value) const { return lookup<Translator>(value); }

    template<typename Translator, typename U>
    AddResult add(const U& value) LIFETIME_BOUND
    {
        return addResult(m_table.template add<Translator>(value, [&](ValueType* slot, unsigned hash) { Translator::translate(slot, value, hash); }));
    }

    // By the raw pointer, where the elements are smart pointers.
    template<SmartPtr V = ValueType> ALWAYS_INLINE iterator find(RawPointer<V> value) const LIFETIME_BOUND { return find<Hash, RawPointer<V>>(value); }
    template<SmartPtr V = ValueType> bool contains(RawPointer<V> value) const { return contains<Hash, RawPointer<V>>(value); }
    template<SmartPtr V = ValueType> bool remove(RawPointer<V> value) { return removeEntry(lookup<Hash>(value)); }
    template<SmartPtr V = ValueType> TakeType take(RawPointer<V> value) { return takeEntry(lookup<Hash>(value)); }

private:
    struct Keys {
        static const ValueType& extract(const ValueType& entry) { return entry; }
        static unsigned hash(const ValueType& key) { return Hash::hash(key); }
    };
    using Table = Detail::HashTable<ValueType, Keys>;
    using Insertion = typename Table::Insertion;

    ALWAYS_INLINE AddResult addResult(Insertion insertion) { return { m_table.iteratorAt(insertion.entry), insertion.isNewEntry }; }

    ValueType* entryAt(iterator position) { return position == end() ? nullptr : const_cast<ValueType*>(position.get()); }

    template<typename Translator, typename U>
    ValueType* lookup(const U& value) const
    {
        return m_table.template lookup<Translator>(value);
    }

    template<typename V>
    Insertion insert(V&& value)
    {
        return m_table.template add<Hash>(value, [&](ValueType* slot, unsigned) ALWAYS_INLINE_LAMBDA { std::construct_at(slot, std::forward<V>(value)); });
    }

    bool removeEntry(ValueType* entry)
    {
        if (!entry)
            return false;
        m_table.remove(entry);
        return true;
    }

    TakeType takeEntry(ValueType* entry)
    {
        if (!entry)
            return Traits::take(Traits::emptyValue());
        auto value = Traits::take(WTF::move(*entry));
        m_table.remove(entry);
        return value;
    }

    Table m_table;
};

template<typename T, typename Hash = DefaultHash<T>, typename Traits = HashTraits<T>>
using UncheckedKeyHashSet = HashSet<T, Hash, Traits>;

}

using WTF::HashSet;
using WTF::UncheckedKeyHashSet;
