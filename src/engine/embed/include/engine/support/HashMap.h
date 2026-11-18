#pragma once

#include "engine/support/HashFunctions.h"
#include "engine/support/HashTable.h"
#include "engine/support/HashTraits.h"
#include "engine/support/IteratorRange.h"
#include "engine/support/KeyValuePair.h"

#include <initializer_list>
#include <optional>

namespace WTF {

template<typename Key, typename Value, typename Hash, typename KeyTraits, typename MappedTraits>
class HashMap final {
    WTF_MAKE_TZONE_ALLOCATED(HashMap);

public:
    using KeyType = typename KeyTraits::TraitType;
    using MappedType = typename MappedTraits::TraitType;
    using KeyValuePairType = KeyValuePair<KeyType, MappedType>;
    using iterator = Detail::HashTableIterator<KeyValuePairType>;
    using const_iterator = Detail::HashTableIterator<const KeyValuePairType>;
    using AddResult = Detail::HashTableAddResult<iterator>;

private:
    using MappedPeekType = typename MappedTraits::PeekType;
    using MappedTakeType = typename MappedTraits::TakeType;
    template<typename K> using RawPointer = const typename GetPtrHelper<K>::UnderlyingType*;
    template<typename Iterator, auto member> using MemberRange = SizedIteratorRange<HashMap, MemberIterator<Iterator, member>>;

public:
    HashMap() = default;

    HashMap(std::initializer_list<KeyValuePairType> entries)
    {
        reserveInitialCapacity(entries.size());
        for (auto& entry : entries)
            add(entry.key, entry.value);
    }

    void swap(HashMap& other) { m_table.swap(other.m_table); }

    unsigned size() const { return m_table.size(); }
    unsigned capacity() const { return m_table.capacity(); }
    size_t byteSize() const { return m_table.byteSize(); }
    bool isEmpty() const { return m_table.isEmpty(); }

    void reserveInitialCapacity(unsigned keyCount) { m_table.reserveInitialCapacity(keyCount); }

    iterator begin() LIFETIME_BOUND { return m_table.begin(); }
    iterator end() LIFETIME_BOUND { return {}; }
    const_iterator begin() const LIFETIME_BOUND { return m_table.begin(); }
    const_iterator end() const LIFETIME_BOUND { return {}; }

    auto keys() LIFETIME_BOUND { return MemberRange<iterator, &KeyValuePairType::key> { *this, begin(), end() }; }
    auto keys() const LIFETIME_BOUND { return MemberRange<const_iterator, &KeyValuePairType::key> { *this, begin(), end() }; }
    auto values() LIFETIME_BOUND { return MemberRange<iterator, &KeyValuePairType::value> { *this, begin(), end() }; }
    auto values() const LIFETIME_BOUND { return MemberRange<const_iterator, &KeyValuePairType::value> { *this, begin(), end() }; }

    ALWAYS_INLINE iterator find(const KeyType& key) LIFETIME_BOUND { return find<Hash>(key); }
    ALWAYS_INLINE const_iterator find(const KeyType& key) const LIFETIME_BOUND { return find<Hash>(key); }
    bool contains(const KeyType& key) const { return contains<Hash>(key); }
    MappedPeekType get(const KeyType& key) const { return get<Hash>(key); }

    std::optional<MappedType> getOptional(const KeyType& key) const
    {
        if (auto* entry = lookup<Hash>(key))
            return entry->value;
        return std::nullopt;
    }

    // Leaves an entry that is there as it is.
    template<typename V> ALWAYS_INLINE AddResult add(const KeyType& key, V&& value) LIFETIME_BOUND { return addResult(insert(key, std::forward<V>(value))); }
    template<typename V> ALWAYS_INLINE AddResult add(KeyType&& key, V&& value) LIFETIME_BOUND { return addResult(insert(WTF::move(key), std::forward<V>(value))); }

    template<typename V> ALWAYS_INLINE AddResult set(const KeyType& key, V&& value) LIFETIME_BOUND { return addResult(insertOrAssign(key, std::forward<V>(value))); }
    template<typename V> ALWAYS_INLINE AddResult set(KeyType&& key, V&& value) LIFETIME_BOUND { return addResult(insertOrAssign(WTF::move(key), std::forward<V>(value))); }

    ALWAYS_INLINE AddResult ensure(const KeyType& key, const Invocable<MappedType()> auto& create) LIFETIME_BOUND { return addResult(findOrCreate(key, create)); }
    ALWAYS_INLINE AddResult ensure(KeyType&& key, const Invocable<MappedType()> auto& create) LIFETIME_BOUND { return addResult(findOrCreate(WTF::move(key), create)); }

    bool remove(const KeyType& key) { return remove<Hash>(key); }
    bool remove(iterator position) { return position != end() && removeEntry(position.get()); }
    bool removeIf(const Invocable<bool(KeyValuePairType&)> auto& matches) { return m_table.removeIf(matches); }
    void clear() { m_table.clear(); }

    MappedTakeType take(const KeyType& key) { return takeEntry(lookup<Hash>(key)); }
    MappedTakeType take(iterator position) { return takeEntry(position == end() ? nullptr : position.get()); }

    std::optional<MappedType> takeOptional(const KeyType& key)
    {
        auto* entry = lookup<Hash>(key);
        if (!entry)
            return std::nullopt;
        std::optional<MappedType> value { WTF::move(entry->value) };
        m_table.remove(entry);
        return value;
    }

    // By a value of another type. The translator has hash(value) and equal(key, value).
    template<typename Translator, typename T> ALWAYS_INLINE iterator find(const T& value) LIFETIME_BOUND { return m_table.iteratorAt(lookup<Translator>(value)); }
    template<typename Translator, typename T> ALWAYS_INLINE const_iterator find(const T& value) const LIFETIME_BOUND { return m_table.iteratorAt(lookup<Translator>(value)); }
    template<typename Translator, typename T> bool contains(const T& value) const { return lookup<Translator>(value); }
    template<typename Translator, typename T> bool remove(const T& value) { return removeEntry(lookup<Translator>(value)); }

    template<typename Translator, typename T>
    MappedPeekType get(const T& value) const
    {
        if (auto* entry = lookup<Translator>(value))
            return MappedTraits::peek(entry->value);
        return MappedTraits::peek(MappedTraits::emptyValue());
    }

    // By the raw pointer, where keys are smart pointers.
    template<SmartPtr K = KeyType> ALWAYS_INLINE iterator find(RawPointer<K> key) LIFETIME_BOUND { return find<Hash, RawPointer<K>>(key); }
    template<SmartPtr K = KeyType> ALWAYS_INLINE const_iterator find(RawPointer<K> key) const LIFETIME_BOUND { return find<Hash, RawPointer<K>>(key); }
    template<SmartPtr K = KeyType> bool contains(RawPointer<K> key) const { return contains<Hash, RawPointer<K>>(key); }
    template<SmartPtr K = KeyType> MappedPeekType get(RawPointer<K> key) const { return get<Hash, RawPointer<K>>(key); }
    template<SmartPtr K = KeyType> bool remove(RawPointer<K> key) { return remove<Hash, RawPointer<K>>(key); }
    template<SmartPtr K = KeyType> MappedTakeType take(RawPointer<K> key) { return takeEntry(lookup<Hash>(key)); }

private:
    struct Keys {
        static const KeyType& extract(const KeyValuePairType& entry) { return entry.key; }
        static unsigned hash(const KeyType& key) { return Hash::hash(key); }
    };
    using Table = Detail::HashTable<KeyValuePairType, Keys>;
    using Insertion = typename Table::Insertion;

    ALWAYS_INLINE AddResult addResult(Insertion insertion) { return { m_table.iteratorAt(insertion.entry), insertion.isNewEntry }; }

    template<typename Translator, typename T>
    KeyValuePairType* lookup(const T& value) const
    {
        return m_table.template lookup<Translator>(value);
    }

    template<typename K, typename V>
    Insertion insert(K&& key, V&& value)
    {
        return m_table.template add<Hash>(key, [&](KeyValuePairType* slot, unsigned) ALWAYS_INLINE_LAMBDA {
            std::construct_at(std::addressof(slot->key), std::forward<K>(key));
            ::new (NotNull, std::addressof(slot->value)) MappedType([&]() ALWAYS_INLINE_LAMBDA -> MappedType { return std::forward<V>(value); }());
        });
    }

    template<typename K, typename V>
    Insertion insertOrAssign(K&& key, V&& value)
    {
        auto insertion = insert(std::forward<K>(key), std::forward<V>(value));
        if (!insertion.isNewEntry)
            insertion.entry->value = std::forward<V>(value);
        return insertion;
    }

    // `create` may change the map.
    template<typename K>
    Insertion findOrCreate(K&& key, const auto& create)
    {
        if (auto* entry = lookup<Hash>(key))
            return { entry, false };
        return insert(std::forward<K>(key), create());
    }

    bool removeEntry(KeyValuePairType* entry)
    {
        if (!entry)
            return false;
        m_table.remove(entry);
        return true;
    }

    MappedTakeType takeEntry(KeyValuePairType* entry)
    {
        if (!entry)
            return MappedTraits::take(MappedTraits::emptyValue());
        auto value = MappedTraits::take(WTF::move(entry->value));
        m_table.remove(entry);
        return value;
    }

    Table m_table;
};

template<typename Key, typename Value, typename Hash = DefaultHash<Key>, typename KeyTraits = HashTraits<Key>, typename MappedTraits = HashTraits<Value>>
using UncheckedKeyHashMap = HashMap<Key, Value, Hash, KeyTraits, MappedTraits>;

}

using WTF::HashMap;
using WTF::UncheckedKeyHashMap;
