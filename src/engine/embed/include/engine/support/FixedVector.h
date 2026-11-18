#pragma once

#include "engine/support/MathExtras.h"
#include "engine/support/Vector.h"

namespace WTF {

// One pointer, to the first element. The size is in front of it.
template<typename T>
class TRIVIAL_ABI FixedVector {
    WTF_MAKE_TZONE_ALLOCATED(FixedVector);

public:
    using value_type = T;
    using iterator = T*;
    using const_iterator = const T*;

    FixedVector() = default;

    // Plain data is left as the allocator had it.
    explicit FixedVector(size_t size)
        : m_elements(allocate(size))
    {
        Detail::initializeUnlessPlainData(m_elements, size);
    }

    FixedVector(FillWith, size_t size, const T& value)
        : m_elements(allocate(size))
    {
        Detail::uninitializedFill(m_elements, size, value);
    }

    template<size_t inlineCapacity, typename OverflowHandler, size_t minCapacity, typename Malloc>
    explicit FixedVector(Vector<T, inlineCapacity, OverflowHandler, minCapacity, Malloc>&& vector)
        : m_elements(allocate(vector.size()))
    {
        std::uninitialized_move(vector.begin(), vector.end(), m_elements);
        vector.clear();
    }

    FixedVector(const FixedVector& other)
        : m_elements(allocate(other.size()))
    {
        Detail::uninitializedCopy(other.begin(), other.size(), m_elements);
    }

    FixedVector(FixedVector&& other)
        : m_elements(std::exchange(other.m_elements, nullptr))
    {
    }

    ~FixedVector() { clear(); }

    FixedVector& operator=(const FixedVector& other) { return *this = FixedVector(other); }

    FixedVector& operator=(FixedVector&& other)
    {
        FixedVector moved(WTF::move(other));
        std::swap(m_elements, moved.m_elements);
        return *this;
    }

    size_t size() const { return m_elements ? sizeOf(m_elements) : 0; }
    size_t byteSize() const { return size() * sizeof(T); }
    bool isEmpty() const { return !m_elements; }

    iterator begin() LIFETIME_BOUND { return m_elements; }
    iterator end() LIFETIME_BOUND { return m_elements + size(); }
    const_iterator begin() const LIFETIME_BOUND { return m_elements; }
    const_iterator end() const LIFETIME_BOUND { return m_elements + size(); }

    std::span<const T> span() const LIFETIME_BOUND { return { m_elements, size() }; }
    std::span<T> mutableSpan() LIFETIME_BOUND { return { m_elements, size() }; }

    T& at(size_t index) LIFETIME_BOUND
    {
        RELEASE_ASSERT(index < size());
        return m_elements[index];
    }

    const T& at(size_t index) const LIFETIME_BOUND
    {
        RELEASE_ASSERT(index < size());
        return m_elements[index];
    }

    T& operator[](size_t index) LIFETIME_BOUND { return at(index); }
    const T& operator[](size_t index) const LIFETIME_BOUND { return at(index); }

    void clear()
    {
        if (T* elements = std::exchange(m_elements, nullptr)) {
            std::destroy_n(elements, sizeOf(elements));
            fastFree(reinterpret_cast<std::byte*>(elements) - headerSize());
        }
    }

private:
    static constexpr size_t headerSize() { return std::max(sizeof(unsigned), alignof(T)); }
    static unsigned& sizeOf(T* elements) { return reinterpret_cast<unsigned*>(elements)[-1]; }

    static T* allocate(size_t size)
    {
        if (!size)
            return nullptr;
        RELEASE_ASSERT(size <= std::numeric_limits<unsigned>::max());
        auto* elements = reinterpret_cast<T*>(static_cast<std::byte*>(fastMalloc(headerSize() + size * sizeof(T))) + headerSize());
        sizeOf(elements) = size;
        return elements;
    }

    T* m_elements { nullptr };
};

}

using WTF::FixedVector;
