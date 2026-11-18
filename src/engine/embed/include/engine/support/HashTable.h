#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/VectorTraits.h"

#include <bit>
#include <iterator>

namespace WTF::Detail {

// Open addressing with triangular probing. An allocation has this header, a control byte for each slot, and the slots.
struct HashTableHeader {
    // The byte of a full slot has seven bits that depend on the hash.
    static constexpr uint8_t empty = 0xff;
    static constexpr uint8_t deleted = 0xfe;
    static bool isFull(uint8_t control) { return control < 0x80; }

    static constexpr unsigned groupSize = sizeof(uint64_t);
    static constexpr unsigned minCapacity = groupSize;
    static constexpr unsigned maxCapacity = 1u << 31;
    static constexpr unsigned maxSmallCapacity = 1024;
    static constexpr unsigned minLoadDivisor = 6;

    // The low bits of a hash pick the slot, and the high ones are zero for strings.
    static uint8_t controlByte(unsigned hash) { return hash * 0x9e3779b1u >> 25; }

    // The number of slots that are not empty at which a table is made anew.
    static constexpr unsigned loadLimit(unsigned capacity) { return capacity <= maxSmallCapacity ? capacity - capacity / 4 : capacity / 2; }

    // Well away from both the load at which a table grows and the load at which it shrinks.
    static unsigned bestCapacity(unsigned keyCount)
    {
        uint64_t keys = keyCount;
        uint64_t capacity = std::bit_ceil(keys);
        if (capacity <= maxSmallCapacity ? keys * 4 >= capacity * 3 : keys * 2 >= capacity)
            capacity *= 2;
        if (capacity <= maxSmallCapacity ? keys * 48 >= capacity * 29 : keys * 12 >= capacity * 5)
            capacity *= 2;
        RELEASE_ASSERT(capacity <= maxCapacity);
        return std::max<unsigned>(capacity, minCapacity);
    }

    bool shouldShrink() const { return uint64_t { keyCount } * minLoadDivisor < capacity && capacity > minCapacity; }

    unsigned expandedCapacity() const
    {
        if (uint64_t { keyCount } * minLoadDivisor < uint64_t { capacity } * 2)
            return capacity;
        RELEASE_ASSERT(capacity < maxCapacity);
        return capacity * 2;
    }

    uint8_t* controlBytes() { return reinterpret_cast<uint8_t*>(this + 1); }

    // The high bit of each byte says whether that slot of the group is full.
    uint64_t fullSlots(unsigned firstOfGroup)
    {
        uint64_t bytes;
        memcpy(&bytes, controlBytes() + firstOfGroup, sizeof(bytes));
        return ~bytes & 0x8080808080808080;
    }

    static unsigned firstSlot(uint64_t fullSlots) { return std::countr_zero(fullSlots) / 8; }

    template<typename Entry>
    static size_t offsetOfSlots(unsigned capacity)
    {
        static_assert(alignof(Entry) <= 16);
        size_t offset = sizeof(HashTableHeader) + capacity;
        return alignof(Entry) <= groupSize ? offset : (offset + 15) & -16;
    }

    template<typename Entry>
    Entry* slots() { return reinterpret_cast<Entry*>(reinterpret_cast<std::byte*>(this) + offsetOfSlots<Entry>(capacity)); }

    void didChange()
    {
#if ASSERT_ENABLED
        ++version;
#endif
    }

    // The two counters are apart, or the compiler updates them in a vector register.
    unsigned keyCount;
    unsigned capacity;
    unsigned emptySlotsBeforeLimit;
    // An iterator does not outlive a change.
    unsigned version;
};

template<typename Entry>
class HashTableIterator {
public:
    using iterator_category = std::forward_iterator_tag;
    using value_type = std::remove_const_t<Entry>;
    using difference_type = ptrdiff_t;
    using pointer = Entry*;
    using reference = Entry&;

    // The end of every table.
    HashTableIterator() = default;

    template<typename MutableEntry>
        requires std::same_as<const MutableEntry, Entry>
    HashTableIterator(const HashTableIterator<MutableEntry>& other)
        : m_entry(other.m_entry)
        , m_table(other.m_table)
        , m_fullSlots(other.m_fullSlots)
        , m_group(other.m_group)
        , m_version(other.m_version)
    {
    }

    Entry* get() const
    {
        ASSERT(m_entry && m_version == m_table->version);
        return m_entry;
    }
    Entry& operator*() const { return *get(); }
    Entry* operator->() const { return get(); }

    HashTableIterator& operator++()
    {
        ASSERT(m_entry && m_version == m_table->version);
        m_fullSlots &= m_fullSlots - 1;
        settle();
        return *this;
    }

    HashTableIterator operator++(int)
    {
        auto result = *this;
        ++*this;
        return result;
    }

    friend bool operator==(const HashTableIterator& a, const HashTableIterator& b) { return a.m_entry == b.m_entry; }

private:
    template<typename> friend class HashTableIterator;
    template<typename, typename> friend class HashTable;

    using Header = HashTableHeader;

    explicit HashTableIterator(Header& table)
        : m_table(&table)
        , m_fullSlots(table.fullSlots(0))
        , m_version(table.version)
    {
        settle();
    }

    // All but the entry is dead code where the caller does not go on to the next one.
    ALWAYS_INLINE HashTableIterator(Header& table, Entry& entry)
        : m_entry(&entry)
        , m_table(&table)
        , m_version(table.version)
    {
        unsigned index = &entry - table.slots<Entry>();
        m_group = index & -Header::groupSize;
        m_fullSlots = table.fullSlots(m_group) & ~uint64_t { 0 } << (index - m_group) * 8;
    }

    void settle()
    {
        while (!m_fullSlots) {
            m_group += Header::groupSize;
            if (m_group == m_table->capacity) {
                m_entry = nullptr;
                return;
            }
            m_fullSlots = m_table->fullSlots(m_group);
        }
        m_entry = m_table->slots<Entry>() + m_group + Header::firstSlot(m_fullSlots);
    }

    Entry* m_entry { nullptr };
    Header* m_table { nullptr };
    // From the current one to the end of its group.
    uint64_t m_fullSlots { 0 };
    unsigned m_group { 0 };
    unsigned m_version { 0 };
};

template<typename Iterator>
struct HashTableAddResult {
    explicit operator bool() const { return isNewEntry; }

    Iterator iterator;
    bool isNewEntry;
};

// `Keys` has extract(entry) and hash(key). A lookup names a translator, which has hash(value) and equal(key, value).
template<typename Entry, typename Keys>
class TRIVIAL_ABI HashTable {
public:
    using iterator = HashTableIterator<Entry>;

    struct Insertion {
        Entry* entry;
        bool isNewEntry;
    };

    HashTable() = default;

    HashTable(const HashTable& other)
    {
        if (other.isEmpty())
            return;
        reserveInitialCapacity(other.size());
        forEachFullSlot(*other.m_table, [&](const Entry& entry) ALWAYS_INLINE_LAMBDA {
            std::construct_at(claimEmptySlot(*m_table, entry), entry);
        });
        setKeyCountOfNewTable(other.size());
    }

    HashTable(HashTable&& other)
        : m_table(std::exchange(other.m_table, nullptr))
    {
    }

    ~HashTable() { clear(); }

    HashTable& operator=(const HashTable& other)
    {
        if (this != &other)
            *this = HashTable(other);
        return *this;
    }

    HashTable& operator=(HashTable&& other)
    {
        HashTable moved(WTF::move(other));
        swap(moved);
        return *this;
    }

    void swap(HashTable& other) { std::swap(m_table, other.m_table); }

    unsigned size() const { return m_table ? m_table->keyCount : 0; }
    unsigned capacity() const { return m_table ? m_table->capacity : 0; }
    size_t byteSize() const { return m_table ? allocationSize(m_table->capacity) : 0; }
    bool isEmpty() const { return !size(); }

    iterator begin() const { return isEmpty() ? iterator() : iterator(*m_table); }
    ALWAYS_INLINE iterator iteratorAt(Entry* entry) const { return entry ? iterator(*m_table, *entry) : iterator(); }

    void reserveInitialCapacity(unsigned keyCount)
    {
        ASSERT(!m_table);
        m_table = allocate(Header::bestCapacity(keyCount));
    }

    template<typename Translator>
    ALWAYS_INLINE Entry* lookup(const auto& key) const
    {
        Header* table = m_table;
        if (!table)
            return nullptr;
        unsigned hash = Translator::hash(key);
        uint8_t wanted = Header::controlByte(hash);
        unsigned mask = table->capacity - 1;
        const uint8_t* controlBytes = table->controlBytes();
        Entry* slots = table->slots<Entry>();
        unsigned index = hash & mask;
        // Most lookups end before the loop.
        uint8_t control = controlBytes[index];
        if (control == Header::empty)
            return nullptr;
        if (control == wanted && Translator::equal(Keys::extract(slots[index]), key))
            return slots + index;
        for (unsigned step = 1;; ++step) {
            index = (index + step) & mask;
            control = controlBytes[index];
            if (control == wanted && Translator::equal(Keys::extract(slots[index]), key))
                return slots + index;
            if (control == Header::empty)
                return nullptr;
        }
    }

    // `construct(slot, hash)` makes the entry if there is none for the key. It leaves the table alone.
    template<typename Translator>
    ALWAYS_INLINE Insertion add(const auto& key, const auto& construct)
    {
        if (!m_table) [[unlikely]]
            allocateFirstTable();
        Header* table = m_table;
        unsigned hash = Translator::hash(key);
        uint8_t wanted = Header::controlByte(hash);
        unsigned mask = table->capacity - 1;
        uint8_t* controlBytes = table->controlBytes();
        Entry* slots = table->slots<Entry>();
        unsigned index = hash & mask;
        if (uint8_t control = controlBytes[index]; control != Header::empty) {
            constexpr unsigned none = -1;
            unsigned deletedIndex = none;
            unsigned step = 1;
            do {
                if (control == wanted && Translator::equal(Keys::extract(slots[index]), key))
                    return { slots + index, false };
                deletedIndex = control == Header::deleted ? index : deletedIndex;
                index = (index + step++) & mask;
                control = controlBytes[index];
            } while (control != Header::empty);
            if (deletedIndex != none) {
                index = deletedIndex;
                ++table->emptySlotsBeforeLimit;
            }
        }
        construct(slots + index, hash);
        controlBytes[index] = wanted;
        ++table->keyCount;
        table->didChange();
        if (!--table->emptySlotsBeforeLimit) [[unlikely]]
            return { expand(slots + index), true };
        return { slots + index, true };
    }

    void remove(Entry* entry)
    {
        markAsDeleted(entry - m_table->slots<Entry>());
        RemovedElement<Entry> removed { entry };
        if (m_table->shouldShrink()) [[unlikely]]
            rehash(m_table->capacity / 2);
    }

    bool removeIf(const auto& matches)
    {
        if (!m_table)
            return false;
        unsigned oldSize = size();
        Entry* slots = m_table->slots<Entry>();
        for (unsigned index = m_table->capacity; index--;) {
            if (!Header::isFull(m_table->controlBytes()[index]) || !matches(slots[index]))
                continue;
            markAsDeleted(index);
            std::destroy_at(slots + index);
        }
        if (m_table->shouldShrink())
            rehash(Header::bestCapacity(size()));
        return size() != oldSize;
    }

    void clear()
    {
        Header* table = std::exchange(m_table, nullptr);
        if (!table)
            return;
        if constexpr (!std::is_trivially_destructible_v<Entry>)
            forEachFullSlot(*table, [](Entry& entry) ALWAYS_INLINE_LAMBDA { std::destroy_at(&entry); });
        fastFree(table);
    }

private:
    using Header = HashTableHeader;

    static size_t allocationSize(unsigned capacity) { return Header::offsetOfSlots<Entry>(capacity) + size_t { capacity } * sizeof(Entry); }

    static Header* allocate(unsigned capacity)
    {
        auto* table = new (NotNull, fastMalloc(allocationSize(capacity))) Header { 0, capacity, Header::loadLimit(capacity), 0 };
        memset(table->controlBytes(), Header::empty, capacity);
        return table;
    }

    NEVER_INLINE void allocateFirstTable() { m_table = allocate(Header::minCapacity); }

    static ALWAYS_INLINE void forEachFullSlot(Header& table, const auto& visit)
    {
        Entry* slots = table.slots<Entry>();
        for (unsigned group = 0, capacity = table.capacity; group != capacity; group += Header::groupSize) {
            for (uint64_t fullSlots = table.fullSlots(group); fullSlots; fullSlots &= fullSlots - 1)
                visit(slots[group + Header::firstSlot(fullSlots)]);
        }
    }

    // For a table that has neither the key nor deleted slots.
    static ALWAYS_INLINE Entry* claimEmptySlot(Header& table, const Entry& entry)
    {
        unsigned hash = Keys::hash(Keys::extract(entry));
        unsigned mask = table.capacity - 1;
        unsigned index = hash & mask;
        for (unsigned step = 1; table.controlBytes()[index] != Header::empty; ++step)
            index = (index + step) & mask;
        table.controlBytes()[index] = Header::controlByte(hash);
        return table.slots<Entry>() + index;
    }

    void setKeyCountOfNewTable(unsigned keyCount)
    {
        m_table->keyCount = keyCount;
        m_table->emptySlotsBeforeLimit -= keyCount;
    }

    void markAsDeleted(unsigned index)
    {
        ASSERT(Header::isFull(m_table->controlBytes()[index]));
        m_table->controlBytes()[index] = Header::deleted;
        --m_table->keyCount;
        m_table->didChange();
    }

    NEVER_INLINE Entry* expand(Entry* tracked) { return rehash(m_table->expandedCapacity(), tracked); }

    // Returns where `tracked` is afterwards.
    NEVER_INLINE Entry* rehash(unsigned newCapacity, Entry* tracked = nullptr)
    {
        Header* oldTable = m_table;
        Header* newTable = allocate(newCapacity);
        Entry* result = nullptr;
        forEachFullSlot(*oldTable, [&](Entry& entry) ALWAYS_INLINE_LAMBDA {
            Entry* slot = claimEmptySlot(*newTable, entry);
            relocate(&entry, slot);
            if (&entry == tracked)
                result = slot;
        });
        m_table = newTable;
        setKeyCountOfNewTable(oldTable->keyCount);
        fastFree(oldTable);
        return result;
    }

    Header* m_table { nullptr };
};

}
