#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/MallocSpan.h"
#include "engine/support/OverflowHandler.h"
#include "engine/support/VectorTraits.h"

#include <algorithm>
#include <initializer_list>
#include <iterator>
#include <limits>
#include <span>
#if ASAN_ENABLED
#include <sanitizer/common_interface_defs.h>
#endif

namespace WTF {

struct FillWith {};

template<typename T>
constexpr bool isValidCapacityForVector(size_t capacity)
{
    return capacity <= std::numeric_limits<int32_t>::max() / sizeof(T);
}

namespace Detail {

enum class FailureAction : bool { Crash,
    Report };

// What fits in a register goes to a slow path by value, so that the fast path need not give it an address.
template<typename T, typename Argument, typename Value = std::remove_cvref_t<Argument>>
using SlowPathArgument = std::conditional_t<std::conjunction_v<std::is_scalar<Value>, std::is_constructible<T, Value>>, Value, Argument&&>;

template<typename T, size_t inlineCapacity>
struct VectorStorage {
    VectorStorage() = default;
    // Takes the attribute TRIVIAL_ABI from a vector that points into itself.
    VectorStorage(VectorStorage&&) = delete;

    T* inlineBuffer() { return reinterpret_cast<T*>(m_inlineBuffer); }

    T* m_buffer { inlineBuffer() };
    unsigned m_capacity { inlineCapacity };
    unsigned m_size { 0 };
    alignas(T) std::byte m_inlineBuffer[inlineCapacity * sizeof(T)];
};

// `bun_engine_vm::StackTrace` has this layout.
template<typename T>
struct VectorStorage<T, 0> {
    T* inlineBuffer() { return nullptr; }

    T* m_buffer { nullptr };
    unsigned m_capacity { 0 };
    unsigned m_size { 0 };
};

}

template<typename T, size_t inlineCapacity, typename OverflowHandler, size_t minCapacity, typename Malloc>
class TRIVIAL_ABI Vector : private Detail::VectorStorage<T, inlineCapacity> {
    WTF_MAKE_TZONE_ALLOCATED(Vector);

public:
    using value_type = T;
    using iterator = T*;
    using const_iterator = const T*;

    constexpr Vector() {}

    // Plain data is left as the allocator had it.
    explicit Vector(size_t size)
    {
        reserveInitialCapacity(size);
        Detail::initializeUnlessPlainData(m_buffer, size);
        setInitialSize(size);
    }

    Vector(FillWith, size_t size, const T& value)
    {
        reserveInitialCapacity(size);
        Detail::uninitializedFill(m_buffer, size, value);
        setInitialSize(size);
    }

    template<std::invocable<size_t> Functor>
    Vector(size_t size, const Functor& elementAt)
    {
        reserveInitialCapacity(size);
        for (size_t i = 0; i < size; ++i)
            new (NotNull, m_buffer + i) T(elementAt(i));
        setInitialSize(size);
    }

    template<typename U, size_t extent>
    Vector(std::span<U, extent> elements)
    {
        reserveInitialCapacity(elements.size());
        Detail::uninitializedCopy(elements.data(), elements.size(), m_buffer);
        setInitialSize(elements.size());
    }

    Vector(std::initializer_list<T> elements)
        : Vector(std::span { elements.begin(), elements.size() })
    {
    }

    Vector(const Vector& other)
        : Vector(other.span())
    {
    }

    template<size_t otherCapacity, typename OtherHandler, size_t otherMinCapacity, typename OtherMalloc>
    explicit Vector(const Vector<T, otherCapacity, OtherHandler, otherMinCapacity, OtherMalloc>& other)
        : Vector(other.span())
    {
    }

    Vector(Vector&& other) { adopt(other); }

    ~Vector()
    {
        std::destroy_n(m_buffer, m_size);
        freeBuffer();
    }

    Vector& operator=(const Vector& other)
    {
        if (this != &other)
            assign(other.span());
        return *this;
    }

    template<size_t otherCapacity, typename OtherHandler, size_t otherMinCapacity, typename OtherMalloc>
    Vector& operator=(const Vector<T, otherCapacity, OtherHandler, otherMinCapacity, OtherMalloc>& other)
    {
        assign(other.span());
        return *this;
    }

    Vector& operator=(Vector&& other)
    {
        if constexpr (!inlineCapacity) {
            Vector moved(WTF::move(other));
            swap(moved);
        } else if (this != &other) {
            clear();
            adopt(other);
        }
        return *this;
    }

    [[nodiscard]] size_t size() const { return m_size; }
    [[nodiscard]] size_t sizeInBytes() const { return size() * sizeof(T); }
    [[nodiscard]] size_t capacity() const { return m_capacity; }
    [[nodiscard]] bool isEmpty() const { return !m_size; }

    [[nodiscard]] std::span<const T> span() const LIFETIME_BOUND { return { m_buffer, m_size }; }
    [[nodiscard]] std::span<T> mutableSpan() LIFETIME_BOUND { return { m_buffer, m_size }; }

    [[nodiscard]] std::span<const T> subspan(size_t offset, size_t length = std::dynamic_extent) const LIFETIME_BOUND
    {
        checkBounds(offset <= size() && (length == std::dynamic_extent || length <= size() - offset));
        return span().subspan(offset, length);
    }

    [[nodiscard]] T& at(size_t index) LIFETIME_BOUND
    {
        checkBounds(index < size());
        return m_buffer[index];
    }

    [[nodiscard]] const T& at(size_t index) const LIFETIME_BOUND
    {
        checkBounds(index < size());
        return m_buffer[index];
    }

    [[nodiscard]] T& operator[](size_t index) LIFETIME_BOUND { return at(index); }
    [[nodiscard]] const T& operator[](size_t index) const LIFETIME_BOUND { return at(index); }

    [[nodiscard]] T& first() LIFETIME_BOUND { return at(0); }
    [[nodiscard]] const T& first() const LIFETIME_BOUND { return at(0); }
    [[nodiscard]] T& last() LIFETIME_BOUND { return at(size() - 1); }
    [[nodiscard]] const T& last() const LIFETIME_BOUND { return at(size() - 1); }

    [[nodiscard]] iterator begin() LIFETIME_BOUND { return m_buffer; }
    [[nodiscard]] iterator end() LIFETIME_BOUND { return m_buffer + m_size; }
    [[nodiscard]] const_iterator begin() const LIFETIME_BOUND { return m_buffer; }
    [[nodiscard]] const_iterator end() const LIFETIME_BOUND { return m_buffer + m_size; }

    size_t findIf(const Invocable<bool(const T&)> auto& matches) const
    {
        for (size_t i = 0; i < size(); ++i) {
            if (matches(at(i)))
                return i;
        }
        return notFound;
    }

    size_t find(const auto& value) const
    {
        return findIf([&](const T& element) { return element == value; });
    }

    size_t reverseFind(const auto& value) const
    {
        for (size_t i = size(); i--;) {
            if (at(i) == value)
                return i;
        }
        return notFound;
    }

    bool containsIf(const Invocable<bool(const T&)> auto& matches) const { return findIf(matches) != notFound; }
    bool contains(const auto& value) const { return find(value) != notFound; }

    ALWAYS_INLINE void append(T&& value) { appendOne<Crash>(WTF::move(value)); }
    template<typename U> ALWAYS_INLINE void append(U&& value) { appendOne<Crash>(std::forward<U>(value)); }
    template<typename U, size_t extent> ALWAYS_INLINE void append(std::span<U, extent> elements) { appendMany<Crash>(elements.data(), elements.size()); }

    ALWAYS_INLINE bool tryAppend(T&& value) { return appendOne<Report>(WTF::move(value)); }
    template<typename U> ALWAYS_INLINE bool tryAppend(U&& value) { return appendOne<Report>(std::forward<U>(value)); }
    template<typename U, size_t extent> ALWAYS_INLINE bool tryAppend(std::span<U, extent> elements) { return appendMany<Report>(elements.data(), elements.size()); }

    template<typename... Arguments> ALWAYS_INLINE void constructAndAppend(Arguments&&... arguments) { appendOne<Crash>(std::forward<Arguments>(arguments)...); }

    ALWAYS_INLINE void unsafeAppendWithoutCapacityCheck(T&& value) { constructAtEnd(WTF::move(value)); }
    template<typename U> ALWAYS_INLINE void unsafeAppendWithoutCapacityCheck(U&& value) { constructAtEnd(std::forward<U>(value)); }

    template<typename U, size_t otherCapacity, typename OtherHandler, size_t otherMinCapacity, typename OtherMalloc>
    void appendVector(const Vector<U, otherCapacity, OtherHandler, otherMinCapacity, OtherMalloc>& other)
    {
        append(other.span());
    }

    template<size_t otherCapacity, typename OtherHandler, size_t otherMinCapacity, typename OtherMalloc>
    void appendVector(Vector<T, otherCapacity, OtherHandler, otherMinCapacity, OtherMalloc>&& other)
    {
        if (other.isEmpty())
            return;
        size_t newSize = size() + other.size();
        if (newSize > capacity())
            expandCapacity<Crash>(newSize);
        annotateNewSize(newSize);
        Detail::relocate(other.begin(), other.size(), end());
        m_size = newSize;
        other.annotateNewSize(0);
        other.m_size = 0;
    }

    void insert(size_t position, T&& value) { insert<T>(position, WTF::move(value)); }

    template<typename U>
    void insert(size_t position, U&& value)
    {
        checkBounds(position <= size());
        // The value may be an element.
        T element(std::forward<U>(value));
        if (size() == capacity())
            expandCapacity<Crash>(size() + 1);
        annotateNewSize(size() + 1);
        Detail::relocateOverlapping(m_buffer + position, size() - position, m_buffer + position + 1);
        new (NotNull, m_buffer + position) T(WTF::move(element));
        ++m_size;
    }

    void removeAt(size_t position)
    {
        checkBounds(position < size());
        Detail::RemovedElement<T> removed { m_buffer + position };
        closeGap(position, 1);
    }

    void removeAt(size_t position, size_t length)
    {
        checkBounds(position <= size() && length <= size() - position);
        if (!length)
            return;
        std::destroy_n(m_buffer + position, length);
        closeGap(position, length);
    }

    void removeLast()
    {
        checkBounds(!isEmpty());
        shrink(size() - 1);
    }

    T takeLast()
    {
        T& element = last();
        T result = WTF::move(element);
        element.~T();
        annotateNewSize(size() - 1);
        --m_size;
        return result;
    }

    bool removeFirstMatching(const Invocable<bool(T&)> auto& matches, size_t startIndex = 0)
    {
        for (size_t i = startIndex; i < size(); ++i) {
            if (matches(at(i))) {
                removeAt(i);
                return true;
            }
        }
        return false;
    }

    unsigned removeAllMatching(const Invocable<bool(T&)> auto& matches, size_t startIndex = 0)
    {
        if (startIndex >= size())
            return 0;
        T* kept = m_buffer + startIndex;
        for (T *element = kept, *stop = end(); element != stop; ++element) {
            if (matches(*element))
                element->~T();
            else if (kept++ != element)
                Detail::relocate(element, kept - 1);
        }
        unsigned removedCount = end() - kept;
        annotateNewSize(size() - removedCount);
        m_size -= removedCount;
        return removedCount;
    }

    void shrink(size_t newSize)
    {
        checkBounds(newSize <= size());
        size_t oldSize = std::exchange(m_size, newSize);
        std::destroy(m_buffer + newSize, m_buffer + oldSize);
        annotate(oldSize, newSize);
    }

    // Plain data is left as it was.
    ALWAYS_INLINE void grow(size_t newSize) { growTo<Crash>(newSize); }
    ALWAYS_INLINE bool tryGrow(size_t newSize) { return growTo<Report>(newSize); }

    void resize(size_t newSize)
    {
        if (newSize <= size())
            shrink(newSize);
        else
            grow(newSize);
    }

    void fill(const T& value, size_t newSize)
    {
        // The value may be an element.
        T element(value);
        prepareToAssign(newSize);
        std::fill_n(m_buffer, size(), element);
        Detail::uninitializedFill(end(), newSize - size(), element);
        m_size = newSize;
    }

    void fill(const T& value) { fill(value, size()); }

    void reverse() { std::reverse(begin(), end()); }

    void reserveCapacity(size_t newCapacity)
    {
        if (newCapacity > capacity())
            reallocate<Crash>(newCapacity);
    }

    bool tryReserveCapacity(size_t newCapacity) { return newCapacity <= capacity() || reallocate<Report>(newCapacity); }

    // For a vector that has never held anything.
    ALWAYS_INLINE void reserveInitialCapacity(size_t initialCapacity) { allocateInitialBuffer<Crash>(initialCapacity); }
    ALWAYS_INLINE bool tryReserveInitialCapacity(size_t initialCapacity) { return allocateInitialBuffer<Report>(initialCapacity); }

    void shrinkToFit()
    {
        if (size() == capacity() || usesInlineBuffer())
            return;
        if (size() > inlineCapacity) {
            if constexpr (VectorTraits<T>::canMoveWithMemcpy) {
                annotateNewSize(capacity());
                m_buffer = static_cast<T*>(Malloc::realloc(m_buffer, sizeInBytes()));
                m_capacity = m_size;
            } else
                reallocate<Crash>(size());
            return;
        }
        if constexpr (inlineCapacity > 0)
            Detail::relocate(m_buffer, size(), inlineBuffer());
        freeBuffer();
        resetBuffer();
        annotate(capacity(), size());
    }

    // Frees the buffer too.
    void clear()
    {
        if constexpr (!inlineCapacity)
            Vector old(WTF::move(*this));
        else {
            shrink(0);
            shrinkToFit();
        }
    }

    // The span has the elements, in an allocation that may be larger.
    MallocSpan<T, Malloc> releaseBuffer()
    {
        if (isEmpty() && usesInlineBuffer())
            return {};
        if (usesInlineBuffer())
            reallocate<Crash>(size());
        annotate(size(), capacity());
        auto result = adoptMallocSpan<T, Malloc>(mutableSpan());
        m_size = 0;
        resetBuffer();
        return result;
    }

    void swap(Vector& other)
    {
        if constexpr (!inlineCapacity) {
            std::swap(m_buffer, other.m_buffer);
            std::swap(m_capacity, other.m_capacity);
            std::swap(m_size, other.m_size);
        } else if (this != &other) {
            Vector moved(WTF::move(other));
            other.adopt(*this);
            adopt(moved);
        }
    }

    template<std::invocable<const T&> MapFunction>
    auto map(const MapFunction& mapFunction) const
    {
        return Vector<std::invoke_result_t<MapFunction, const T&>>(size(), [&](size_t index) { return mapFunction(at(index)); });
    }

private:
    template<typename, size_t, typename, size_t, typename> friend class Vector;

    using Storage = Detail::VectorStorage<T, inlineCapacity>;
    using Storage::inlineBuffer;
    using Storage::m_buffer;
    using Storage::m_capacity;
    using Storage::m_size;

    using FailureAction = Detail::FailureAction;
    static constexpr FailureAction Crash = FailureAction::Crash;
    static constexpr FailureAction Report = FailureAction::Report;

    static constexpr bool fitsInRegisters = std::is_trivially_copyable_v<T> && std::is_trivially_copy_constructible_v<T> && sizeof(T) <= 2 * sizeof(void*);

    static ALWAYS_INLINE void checkBounds(bool isInBounds)
    {
        if (!isInBounds) [[unlikely]]
            OverflowHandler::overflowed();
    }

    bool usesInlineBuffer() { return m_buffer == inlineBuffer(); }

    void resetBuffer()
    {
        m_buffer = inlineBuffer();
        m_capacity = inlineCapacity;
    }

    void freeBuffer()
    {
        annotate(size(), capacity());
        if (!usesInlineBuffer())
            Malloc::free(m_buffer);
    }

    // Tells AddressSanitizer how many of the slots in the buffer may be touched.
    void annotate([[maybe_unused]] size_t oldCount, [[maybe_unused]] size_t newCount)
    {
#if ASAN_ENABLED
        RELEASE_ASSERT(oldCount <= capacity() && newCount <= capacity());
        if (m_buffer)
            __sanitizer_annotate_contiguous_container(m_buffer, m_buffer + m_capacity, m_buffer + oldCount, m_buffer + newCount);
#endif
    }

    void annotateNewSize(size_t newSize) { annotate(size(), newSize); }

    void setInitialSize(size_t size)
    {
        m_size = size;
        annotate(capacity(), size);
    }

    // This vector is empty and has no allocation.
    void adopt(Vector& other)
    {
        ASSERT(isEmpty() && usesInlineBuffer());
        if (inlineCapacity && other.usesInlineBuffer()) {
            annotateNewSize(other.size());
            Detail::relocate(other.m_buffer, other.size(), m_buffer);
            other.annotateNewSize(0);
        } else {
            annotateNewSize(capacity());
            m_buffer = other.m_buffer;
            m_capacity = other.m_capacity;
            other.resetBuffer();
        }
        m_size = std::exchange(other.m_size, 0);
    }

    template<FailureAction action>
    static ALWAYS_INLINE bool checkCapacity(size_t capacity)
    {
        if (isValidCapacityForVector<T>(capacity)) [[likely]]
            return true;
        if constexpr (action == Crash)
            CRASH();
        return false;
    }

    template<FailureAction action>
    static ALWAYS_INLINE T* allocate(size_t capacity)
    {
        if (!checkCapacity<action>(capacity))
            return nullptr;
        size_t bytes = capacity * sizeof(T);
        return static_cast<T*>(action == Crash ? Malloc::malloc(bytes) : Malloc::tryMalloc(bytes));
    }

    template<FailureAction action>
    bool allocateInitialBuffer(size_t initialCapacity)
    {
        ASSERT_WITH_SECURITY_IMPLICATION(isEmpty() && usesInlineBuffer());
        if (initialCapacity <= inlineCapacity)
            return true;
        T* buffer = allocate<action>(initialCapacity);
        if (action == Report && !buffer) [[unlikely]]
            return false;
        m_buffer = buffer;
        m_capacity = initialCapacity;
        return true;
    }

    // Inline, where the compiler sees that the buffers are distinct.
    ALWAYS_INLINE void moveElementsTo(T* newBuffer, size_t newCapacity)
    {
        if (m_size)
            Detail::relocate(m_buffer, size(), newBuffer);
        freeBuffer();
        m_buffer = newBuffer;
        m_capacity = newCapacity;
    }

    template<FailureAction action>
    bool reallocate(size_t newCapacity)
    {
        ASSERT(newCapacity && newCapacity >= size());
        T* newBuffer = allocate<action>(newCapacity);
        if (action == Report && !newBuffer) [[unlikely]]
            return false;
        moveElementsTo(newBuffer, newCapacity);
        annotate(capacity(), size());
        return true;
    }

    size_t expandedCapacity(size_t requiredCapacity) const
    {
        constexpr size_t maxCapacity = std::numeric_limits<int32_t>::max() / sizeof(T);
        return std::max(requiredCapacity, std::min(std::max(minCapacity, Malloc::nextCapacity(capacity())), maxCapacity));
    }

    template<FailureAction action>
    NEVER_INLINE bool expandCapacity(size_t requiredCapacity)
    {
        return reallocate<action>(expandedCapacity(requiredCapacity));
    }

    template<typename... Arguments>
    ALWAYS_INLINE void constructAtEnd(Arguments&&... arguments)
    {
        ASSERT_WITH_SECURITY_IMPLICATION(size() < capacity());
        annotateNewSize(size() + 1);
        unsigned oldSize = m_size;
        new (NotNull, m_buffer + oldSize) T(std::forward<Arguments>(arguments)...);
        m_size = oldSize + 1;
    }

    template<FailureAction action, typename... Arguments>
    ALWAYS_INLINE bool appendOne(Arguments&&... arguments)
    {
        if (m_size != m_capacity) [[likely]] {
            constructAtEnd(std::forward<Arguments>(arguments)...);
            return true;
        }
        if constexpr (fitsInRegisters)
            return expandAndAppend<action>(T(std::forward<Arguments>(arguments)...));
        else
            return expandAndConstruct<action, Detail::SlowPathArgument<T, Arguments>...>(std::forward<Arguments>(arguments)...);
    }

    template<FailureAction action>
    NEVER_INLINE bool expandAndAppend(T value)
    {
        if (!reallocate<action>(expandedCapacity(size() + 1)))
            return false;
        constructAtEnd(value);
        return true;
    }

    // The arguments may refer to elements, so the old buffer stays until they have been used.
    template<FailureAction action, typename... Arguments>
    NEVER_INLINE bool expandAndConstruct(Arguments... arguments)
    {
        size_t newCapacity = expandedCapacity(size() + 1);
        T* newBuffer = allocate<action>(newCapacity);
        if (action == Report && !newBuffer) [[unlikely]]
            return false;
        new (NotNull, newBuffer + size()) T(std::forward<Arguments>(arguments)...);
        moveElementsTo(newBuffer, newCapacity);
        setInitialSize(size() + 1);
        return true;
    }

    template<FailureAction action, typename U>
    ALWAYS_INLINE bool appendMany(const U* elements, size_t count)
    {
        size_t oldSize = size();
        if (count > capacity() - oldSize) {
            elements = static_cast<const U*>(expandToAppend<action>(elements, count));
            if (action == Report && !elements) [[unlikely]]
                return false;
        }
        annotateNewSize(oldSize + count);
        Detail::uninitializedCopy(elements, count, m_buffer + oldSize);
        m_size = oldSize + count;
        return true;
    }

    // Returns where `source`, which may be in the buffer, is afterwards.
    template<FailureAction action>
    NEVER_INLINE const void* expandToAppend(const void* source, size_t count)
    {
        uintptr_t offset = reinterpret_cast<uintptr_t>(source) - reinterpret_cast<uintptr_t>(m_buffer);
        if (!checkCapacity<action>(count) || !expandCapacity<action>(size() + count))
            return nullptr;
        return offset < sizeInBytes() ? reinterpret_cast<const std::byte*>(m_buffer) + offset : source;
    }

    template<FailureAction action>
    bool growTo(size_t newSize)
    {
        RELEASE_ASSERT(newSize >= size());
        if (newSize > capacity() && !expandCapacity<action>(newSize))
            return false;
        annotateNewSize(newSize);
        Detail::initializeUnlessPlainData(end(), newSize - size());
        m_size = newSize;
        return true;
    }

    void closeGap(size_t position, size_t length)
    {
        Detail::relocateOverlapping(m_buffer + position + length, size() - position - length, m_buffer + position);
        annotateNewSize(size() - length);
        m_size -= length;
    }

    // Leaves room for `newSize` elements, and no more elements than that.
    void prepareToAssign(size_t newSize)
    {
        if (newSize < size())
            shrink(newSize);
        else if (newSize > capacity()) {
            clear();
            reserveCapacity(newSize);
        }
        annotateNewSize(newSize);
    }

    void assign(std::span<const T> elements)
    {
        prepareToAssign(elements.size());
        std::copy_n(elements.data(), size(), m_buffer);
        Detail::uninitializedCopy(elements.data() + size(), elements.size() - size(), end());
        m_size = elements.size();
    }
};

template<typename T, size_t extent> Vector(std::span<const T, extent>) -> Vector<T>;

template<typename T, size_t inlineCapacity, typename OverflowHandler, size_t minCapacity, typename Malloc>
inline void swap(Vector<T, inlineCapacity, OverflowHandler, minCapacity, Malloc>& a, Vector<T, inlineCapacity, OverflowHandler, minCapacity, Malloc>& b)
{
    a.swap(b);
}

template<typename T, size_t capacityA, typename HandlerA, size_t minCapacityA, typename MallocA, size_t capacityB, typename HandlerB, size_t minCapacityB, typename MallocB>
bool operator==(const Vector<T, capacityA, HandlerA, minCapacityA, MallocA>& a, const Vector<T, capacityB, HandlerB, minCapacityB, MallocB>& b)
{
    if (a.size() != b.size())
        return false;
    if constexpr (VectorTraits<T>::canCompareWithMemcmp)
        return a.isEmpty() || !memcmp(a.begin(), b.begin(), a.sizeInBytes());
    else
        return std::equal(a.begin(), a.end(), b.begin());
}

namespace Detail {

template<typename Collection>
using ElementOf = std::remove_cvref_t<decltype(*std::begin(std::declval<Collection&>()))>;

// The elements of a temporary are moved from.
template<typename Collection, typename Element>
using ForwardedElement = std::conditional_t<std::is_lvalue_reference_v<Collection>, Element&, std::remove_reference_t<Element>&&>;

template<typename Collection>
size_t sizeOf(const Collection& collection)
{
    if constexpr (requires { collection.computeSize(); })
        return collection.computeSize();
    else
        return std::size(collection);
}

}

template<typename Collection, typename MapFunction>
auto map(Collection&& collection, const MapFunction& mapFunction)
{
    using Argument = Detail::ForwardedElement<Collection, decltype(*std::begin(collection))>;
    Vector<std::invoke_result_t<const MapFunction&, Argument>> result;
    result.reserveInitialCapacity(Detail::sizeOf(collection));
    for (auto&& element : collection)
        result.append(mapFunction(static_cast<Argument>(element)));
    return result;
}

template<typename T, typename Collection>
Vector<T> copyToVectorOf(const Collection& collection)
{
    return map(collection, [](auto& element) -> T { return element; });
}

template<typename Collection>
Vector<Detail::ElementOf<Collection>> copyToVector(const Collection& collection)
{
    return copyToVectorOf<Detail::ElementOf<Collection>>(collection);
}

}

using WTF::copyToVector;
using WTF::copyToVectorOf;
using WTF::FillWith;
using WTF::Vector;
