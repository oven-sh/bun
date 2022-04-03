/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTHash_DEFINED
#define SkTHash_DEFINED

#include "include/core/SkTypes.h"
#include "include/private/SkChecksum.h"
#include "include/private/SkTemplates.h"
#include <new>
#include <utility>

// Before trying to use SkTHashTable, look below to see if SkTHashMap or SkTHashSet works for you.
// They're easier to use, usually perform the same, and have fewer sharp edges.

// T and K are treated as ordinary copyable C++ types.
// Traits must have:
//   - static K GetKey(T)
//   - static uint32_t Hash(K)
// If the key is large and stored inside T, you may want to make K a const&.
// Similarly, if T is large you might want it to be a pointer.
template <typename T, typename K, typename Traits = T>
class SkTHashTable {
public:
    SkTHashTable()  = default;
    ~SkTHashTable() = default;

    SkTHashTable(const SkTHashTable&  that) { *this = that; }
    SkTHashTable(      SkTHashTable&& that) { *this = std::move(that); }

    SkTHashTable& operator=(const SkTHashTable& that) {
        if (this != &that) {
            fCount     = that.fCount;
            fCapacity  = that.fCapacity;
            fSlots.reset(that.fCapacity);
            for (int i = 0; i < fCapacity; i++) {
                fSlots[i] = that.fSlots[i];
            }
        }
        return *this;
    }

    SkTHashTable& operator=(SkTHashTable&& that) {
        if (this != &that) {
            fCount    = that.fCount;
            fCapacity = that.fCapacity;
            fSlots    = std::move(that.fSlots);

            that.fCount = that.fCapacity = 0;
        }
        return *this;
    }

    // Clear the table.
    void reset() { *this = SkTHashTable(); }

    // How many entries are in the table?
    int count() const { return fCount; }

    // How many slots does the table contain? (Note that unlike an array, hash tables can grow
    // before reaching 100% capacity.)
    int capacity() const { return fCapacity; }

    // Approximately how many bytes of memory do we use beyond sizeof(*this)?
    size_t approxBytesUsed() const { return fCapacity * sizeof(Slot); }

    // !!!!!!!!!!!!!!!!!                 CAUTION                   !!!!!!!!!!!!!!!!!
    // set(), find() and foreach() all allow mutable access to table entries.
    // If you change an entry so that it no longer has the same key, all hell
    // will break loose.  Do not do that!
    //
    // Please prefer to use SkTHashMap or SkTHashSet, which do not have this danger.

    // The pointers returned by set() and find() are valid only until the next call to set().
    // The pointers you receive in foreach() are only valid for its duration.

    // Copy val into the hash table, returning a pointer to the copy now in the table.
    // If there already is an entry in the table with the same key, we overwrite it.
    T* set(T val) {
        if (4 * fCount >= 3 * fCapacity) {
            this->resize(fCapacity > 0 ? fCapacity * 2 : 4);
        }
        return this->uncheckedSet(std::move(val));
    }

    // If there is an entry in the table with this key, return a pointer to it.  If not, null.
    T* find(const K& key) const {
        uint32_t hash = Hash(key);
        int index = hash & (fCapacity-1);
        for (int n = 0; n < fCapacity; n++) {
            Slot& s = fSlots[index];
            if (s.empty()) {
                return nullptr;
            }
            if (hash == s.hash && key == Traits::GetKey(*s)) {
                return &*s;
            }
            index = this->next(index);
        }
        SkASSERT(fCapacity == 0);
        return nullptr;
    }

    // If there is an entry in the table with this key, return it.  If not, null.
    // This only works for pointer type T, and cannot be used to find an nullptr entry.
    T findOrNull(const K& key) const {
        if (T* p = this->find(key)) {
            return *p;
        }
        return nullptr;
    }

    // Remove the value with this key from the hash table.
    void remove(const K& key) {
        SkASSERT(this->find(key));

        uint32_t hash = Hash(key);
        int index = hash & (fCapacity-1);
        for (int n = 0; n < fCapacity; n++) {
            Slot& s = fSlots[index];
            SkASSERT(s.has_value());
            if (hash == s.hash && key == Traits::GetKey(*s)) {
               this->removeSlot(index);
               if (4 * fCount <= fCapacity && fCapacity > 4) {
                   this->resize(fCapacity / 2);
               }
               return;
            }
            index = this->next(index);
        }
    }

    // Call fn on every entry in the table.  You may mutate the entries, but be very careful.
    template <typename Fn>  // f(T*)
    void foreach(Fn&& fn) {
        for (int i = 0; i < fCapacity; i++) {
            if (fSlots[i].has_value()) {
                fn(&*fSlots[i]);
            }
        }
    }

    // Call fn on every entry in the table.  You may not mutate anything.
    template <typename Fn>  // f(T) or f(const T&)
    void foreach(Fn&& fn) const {
        for (int i = 0; i < fCapacity; i++) {
            if (fSlots[i].has_value()) {
                fn(*fSlots[i]);
            }
        }
    }

    // A basic iterator-like class which disallows mutation; sufficient for range-based for loops.
    // Intended for use by SkTHashMap and SkTHashSet via begin() and end().
    // Adding or removing elements may invalidate all iterators.
    template <typename SlotVal>
    class Iter {
    public:
        using TTable = SkTHashTable<T, K, Traits>;

        Iter(const TTable* table, int slot) : fTable(table), fSlot(slot) {}

        static Iter MakeBegin(const TTable* table) {
            return Iter{table, table->firstPopulatedSlot()};
        }

        static Iter MakeEnd(const TTable* table) {
            return Iter{table, table->capacity()};
        }

        const SlotVal& operator*() const {
            return *fTable->slot(fSlot);
        }

        const SlotVal* operator->() const {
            return fTable->slot(fSlot);
        }

        bool operator==(const Iter& that) const {
            // Iterators from different tables shouldn't be compared against each other.
            SkASSERT(fTable == that.fTable);
            return fSlot == that.fSlot;
        }

        bool operator!=(const Iter& that) const {
            return !(*this == that);
        }

        Iter& operator++() {
            fSlot = fTable->nextPopulatedSlot(fSlot);
            return *this;
        }

        Iter operator++(int) {
            Iter old = *this;
            this->operator++();
            return old;
        }

    protected:
        const TTable* fTable;
        int fSlot;
    };

private:
    // Finds the first non-empty slot for an iterator.
    int firstPopulatedSlot() const {
        for (int i = 0; i < fCapacity; i++) {
            if (fSlots[i].has_value()) {
                return i;
            }
        }
        return fCapacity;
    }

    // Increments an iterator's slot.
    int nextPopulatedSlot(int currentSlot) const {
        for (int i = currentSlot + 1; i < fCapacity; i++) {
            if (fSlots[i].has_value()) {
                return i;
            }
        }
        return fCapacity;
    }

    // Reads from an iterator's slot.
    const T* slot(int i) const {
        SkASSERT(fSlots[i].has_value());
        return &*fSlots[i];
    }

    T* uncheckedSet(T&& val) {
        const K& key = Traits::GetKey(val);
        SkASSERT(key == key);
        uint32_t hash = Hash(key);
        int index = hash & (fCapacity-1);
        for (int n = 0; n < fCapacity; n++) {
            Slot& s = fSlots[index];
            if (s.empty()) {
                // New entry.
                s.emplace(std::move(val), hash);
                fCount++;
                return &*s;
            }
            if (hash == s.hash && key == Traits::GetKey(*s)) {
                // Overwrite previous entry.
                // Note: this triggers extra copies when adding the same value repeatedly.
                s.emplace(std::move(val), hash);
                return &*s;
            }

            index = this->next(index);
        }
        SkASSERT(false);
        return nullptr;
    }

    void resize(int capacity) {
        int oldCapacity = fCapacity;
        SkDEBUGCODE(int oldCount = fCount);

        fCount = 0;
        fCapacity = capacity;
        SkAutoTArray<Slot> oldSlots = std::move(fSlots);
        fSlots = SkAutoTArray<Slot>(capacity);

        for (int i = 0; i < oldCapacity; i++) {
            Slot& s = oldSlots[i];
            if (s.has_value()) {
                this->uncheckedSet(*std::move(s));
            }
        }
        SkASSERT(fCount == oldCount);
    }

    void removeSlot(int index) {
        fCount--;

        // Rearrange elements to restore the invariants for linear probing.
        for (;;) {
            Slot& emptySlot = fSlots[index];
            int emptyIndex = index;
            int originalIndex;
            // Look for an element that can be moved into the empty slot.
            // If the empty slot is in between where an element landed, and its native slot, then
            // move it to the empty slot. Don't move it if its native slot is in between where
            // the element landed and the empty slot.
            // [native] <= [empty] < [candidate] == GOOD, can move candidate to empty slot
            // [empty] < [native] < [candidate] == BAD, need to leave candidate where it is
            do {
                index = this->next(index);
                Slot& s = fSlots[index];
                if (s.empty()) {
                    // We're done shuffling elements around.  Clear the last empty slot.
                    emptySlot.reset();
                    return;
                }
                originalIndex = s.hash & (fCapacity - 1);
            } while ((index <= originalIndex && originalIndex < emptyIndex)
                     || (originalIndex < emptyIndex && emptyIndex < index)
                     || (emptyIndex < index && index <= originalIndex));
            // Move the element to the empty slot.
            Slot& moveFrom = fSlots[index];
            emptySlot = std::move(moveFrom);
        }
    }

    int next(int index) const {
        index--;
        if (index < 0) { index += fCapacity; }
        return index;
    }

    static uint32_t Hash(const K& key) {
        uint32_t hash = Traits::Hash(key) & 0xffffffff;
        return hash ? hash : 1;  // We reserve hash 0 to mark empty.
    }

    struct Slot {
        Slot() = default;
        ~Slot() { this->reset(); }

        Slot(const Slot& that) { *this = that; }
        Slot& operator=(const Slot& that) {
            if (this == &that) {
                return *this;
            }
            if (hash) {
                if (that.hash) {
                    val.storage = that.val.storage;
                    hash = that.hash;
                } else {
                    this->reset();
                }
            } else {
                if (that.hash) {
                    new (&val.storage) T(that.val.storage);
                    hash = that.hash;
                } else {
                    // do nothing, no value on either side
                }
            }
            return *this;
        }

        Slot(Slot&& that) { *this = std::move(that); }
        Slot& operator=(Slot&& that) {
            if (this == &that) {
                return *this;
            }
            if (hash) {
                if (that.hash) {
                    val.storage = std::move(that.val.storage);
                    hash = that.hash;
                } else {
                    this->reset();
                }
            } else {
                if (that.hash) {
                    new (&val.storage) T(std::move(that.val.storage));
                    hash = that.hash;
                } else {
                    // do nothing, no value on either side
                }
            }
            return *this;
        }

        T& operator*() & { return val.storage; }
        const T& operator*() const& { return val.storage; }
        T&& operator*() && { return std::move(val.storage); }
        const T&& operator*() const&& { return std::move(val.storage); }

        Slot& emplace(T&& v, uint32_t h) {
            this->reset();
            new (&val.storage) T(std::move(v));
            hash = h;
            return *this;
        }

        bool has_value() const { return hash != 0; }
        explicit operator bool() const { return this->has_value(); }
        bool empty() const { return !this->has_value(); }

        void reset() {
            if (hash) {
                val.storage.~T();
                hash = 0;
            }
        }

        uint32_t hash = 0;

    private:
        union Storage {
            T storage;
            Storage() {}
            ~Storage() {}
        } val;
    };

    int fCount    = 0,
        fCapacity = 0;
    SkAutoTArray<Slot> fSlots;
};

// Maps K->V.  A more user-friendly wrapper around SkTHashTable, suitable for most use cases.
// K and V are treated as ordinary copyable C++ types, with no assumed relationship between the two.
template <typename K, typename V, typename HashK = SkGoodHash>
class SkTHashMap {
public:
    // Clear the map.
    void reset() { fTable.reset(); }

    // How many key/value pairs are in the table?
    int count() const { return fTable.count(); }

    // Approximately how many bytes of memory do we use beyond sizeof(*this)?
    size_t approxBytesUsed() const { return fTable.approxBytesUsed(); }

    // N.B. The pointers returned by set() and find() are valid only until the next call to set().

    // Set key to val in the table, replacing any previous value with the same key.
    // We copy both key and val, and return a pointer to the value copy now in the table.
    V* set(K key, V val) {
        Pair* out = fTable.set({std::move(key), std::move(val)});
        return &out->second;
    }

    // If there is key/value entry in the table with this key, return a pointer to the value.
    // If not, return null.
    V* find(const K& key) const {
        if (Pair* p = fTable.find(key)) {
            return &p->second;
        }
        return nullptr;
    }

    V& operator[](const K& key) {
        if (V* val = this->find(key)) {
            return *val;
        }
        return *this->set(key, V{});
    }

    // Remove the key/value entry in the table with this key.
    void remove(const K& key) {
        SkASSERT(this->find(key));
        fTable.remove(key);
    }

    // Call fn on every key/value pair in the table.  You may mutate the value but not the key.
    template <typename Fn>  // f(K, V*) or f(const K&, V*)
    void foreach(Fn&& fn) {
        fTable.foreach([&fn](Pair* p){ fn(p->first, &p->second); });
    }

    // Call fn on every key/value pair in the table.  You may not mutate anything.
    template <typename Fn>  // f(K, V), f(const K&, V), f(K, const V&) or f(const K&, const V&).
    void foreach(Fn&& fn) const {
        fTable.foreach([&fn](const Pair& p){ fn(p.first, p.second); });
    }

    // Dereferencing an iterator gives back a key-value pair, suitable for structured binding.
    struct Pair : public std::pair<K, V> {
        using std::pair<K, V>::pair;
        static const K& GetKey(const Pair& p) { return p.first; }
        static auto Hash(const K& key) { return HashK()(key); }
    };

    using Iter = typename SkTHashTable<Pair, K>::template Iter<std::pair<K, V>>;

    Iter begin() const {
        return Iter::MakeBegin(&fTable);
    }

    Iter end() const {
        return Iter::MakeEnd(&fTable);
    }

private:
    SkTHashTable<Pair, K> fTable;
};

// A set of T.  T is treated as an ordinary copyable C++ type.
template <typename T, typename HashT = SkGoodHash>
class SkTHashSet {
public:
    // Clear the set.
    void reset() { fTable.reset(); }

    // How many items are in the set?
    int count() const { return fTable.count(); }

    // Is empty?
    bool empty() const { return fTable.count() == 0; }

    // Approximately how many bytes of memory do we use beyond sizeof(*this)?
    size_t approxBytesUsed() const { return fTable.approxBytesUsed(); }

    // Copy an item into the set.
    void add(T item) { fTable.set(std::move(item)); }

    // Is this item in the set?
    bool contains(const T& item) const { return SkToBool(this->find(item)); }

    // If an item equal to this is in the set, return a pointer to it, otherwise null.
    // This pointer remains valid until the next call to add().
    const T* find(const T& item) const { return fTable.find(item); }

    // Remove the item in the set equal to this.
    void remove(const T& item) {
        SkASSERT(this->contains(item));
        fTable.remove(item);
    }

    // Call fn on every item in the set.  You may not mutate anything.
    template <typename Fn>  // f(T), f(const T&)
    void foreach (Fn&& fn) const {
        fTable.foreach(fn);
    }

private:
    struct Traits {
        static const T& GetKey(const T& item) { return item; }
        static auto Hash(const T& item) { return HashT()(item); }
    };

public:
    using Iter = typename SkTHashTable<T, T, Traits>::template Iter<T>;

    Iter begin() const {
        return Iter::MakeBegin(&fTable);
    }

    Iter end() const {
        return Iter::MakeEnd(&fTable);
    }

private:
    SkTHashTable<T, T, Traits> fTable;
};

#endif//SkTHash_DEFINED
