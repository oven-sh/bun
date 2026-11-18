#pragma once

#include "engine/support/Noncopyable.h"
#include "engine/support/Vector.h"

namespace WTF {

// Its elements never move.
template<typename T, size_t segmentSize>
class SegmentedVector final {
    WTF_MAKE_NONCOPYABLE(SegmentedVector);
    WTF_MAKE_TZONE_ALLOCATED(SegmentedVector);

public:
    class Iterator {
    public:
        T& operator*() const { return m_vector.at(m_index); }
        T* operator->() const { return std::addressof(**this); }

        Iterator& operator++()
        {
            ++m_index;
            return *this;
        }

        friend bool operator==(const Iterator& a, const Iterator& b) { return a.m_index == b.m_index; }

    private:
        friend SegmentedVector;

        Iterator(SegmentedVector& vector, size_t index)
            : m_vector(vector)
            , m_index(index)
        {
        }

        SegmentedVector& m_vector;
        size_t m_index;
    };

    SegmentedVector() = default;

    ~SegmentedVector()
    {
        for (size_t i = 0; i < m_size; ++i)
            slot(i)->~T();
        for (T* segment : m_segments)
            fastFree(segment);
    }

    size_t size() const { return m_size; }
    bool isEmpty() const { return !m_size; }

    T& at(size_t index) LIFETIME_BOUND { return *checkedSlot(index); }
    const T& at(size_t index) const LIFETIME_BOUND { return *checkedSlot(index); }
    T& operator[](size_t index) LIFETIME_BOUND { return at(index); }
    const T& operator[](size_t index) const LIFETIME_BOUND { return at(index); }
    T& last() LIFETIME_BOUND { return at(m_size - 1); }

    Iterator begin() LIFETIME_BOUND { return { *this, 0 }; }
    Iterator end() LIFETIME_BOUND { return { *this, m_size }; }

    template<typename... Arguments>
    void append(Arguments&&... arguments)
    {
        if (m_size == m_segments.size() * segmentSize) [[unlikely]]
            m_segments.append(static_cast<T*>(fastMalloc(segmentSize * sizeof(T))));
        new (NotNull, slot(m_size)) T(std::forward<Arguments>(arguments)...);
        ++m_size;
    }

    void removeLast()
    {
        T& element = last();
        --m_size;
        element.~T();
    }

private:
    T* slot(size_t index) const { return m_segments.begin()[index / segmentSize] + index % segmentSize; }

    T* checkedSlot(size_t index) const
    {
        RELEASE_ASSERT(index < m_size);
        return slot(index);
    }

    size_t m_size { 0 };
    Vector<T*> m_segments;
};

}

using WTF::SegmentedVector;
