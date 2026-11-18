#pragma once

#include "engine/support/HashSet.h"
#include "engine/support/ListHashSet.h"
#include "engine/support/WeakPtr.h"

namespace WTF {

namespace Detail {

// An object leaves the set when it is destroyed. What remains of it is cleared out once in a while, never by an iterator.
template<typename T, typename Impl, typename Set>
class WeakSet {
    WTF_MAKE_TZONE_ALLOCATED(WeakSet);

public:
    class iterator {
    public:
        using iterator_category = std::forward_iterator_tag;
        using value_type = T;
        using difference_type = ptrdiff_t;
        using pointer = T*;
        using reference = T&;

        T& operator*() const { return *operator->(); }
        T* operator->() const { return static_cast<T*>((*m_position)->template get<T>()); }

        iterator& operator++()
        {
            ++m_position;
            skipDestroyedObjects();
            return *this;
        }

        friend bool operator==(const iterator&, const iterator&) = default;

    private:
        friend WeakSet;
        using Position = typename Set::const_iterator;

        explicit iterator(Position position)
            : m_position(position)
        {
            skipDestroyedObjects();
        }

        void skipDestroyedObjects()
        {
            while (m_position != Position() && !isAlive(*m_position))
                ++m_position;
        }

        Position m_position;
    };

    iterator begin() const { return iterator(m_set.begin()); }
    iterator end() const { return iterator(m_set.end()); }

    auto add(const T& object)
    {
        willChange();
        return m_set.add(object.weakImpl());
    }

    bool remove(const T& object)
    {
        willChange();
        return m_set.remove(object.weakImplIfExists());
    }

    bool contains(const T& object) const
    {
        auto* impl = object.weakImplIfExists();
        return impl && *impl && m_set.contains(impl);
    }

    void clear()
    {
        m_set.clear();
        m_changesBeforeCleanup = 0;
    }

    unsigned capacity() const { return m_set.capacity(); }
    bool isEmptyIgnoringNullReferences() const { return begin() == end(); }

    unsigned computeSize() const
    {
        const_cast<WeakSet&>(*this).removeDestroyedObjects();
        return m_set.size();
    }

private:
    static bool isAlive(const Ref<Impl>& impl) { return static_cast<bool>(impl.get()); }

    void removeDestroyedObjects()
    {
        m_set.removeIf([](const Ref<Impl>& impl) { return !isAlive(impl); });
        m_changesBeforeCleanup = m_set.size() * 2;
    }

    void willChange()
    {
        if (!m_changesBeforeCleanup--)
            removeDestroyedObjects();
    }

    Set m_set;
    unsigned m_changesBeforeCleanup { 0 };
};

}

template<typename T, typename Impl> class WeakHashSet final : public Detail::WeakSet<T, Impl, HashSet<Ref<Impl>>> {};

// In the order of insertion.
template<typename T, typename Impl> class WeakListHashSet final : public Detail::WeakSet<T, Impl, ListHashSet<Ref<Impl>>> {};

}

using WTF::WeakHashSet;
using WTF::WeakListHashSet;
