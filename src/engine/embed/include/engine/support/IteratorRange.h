#pragma once

#include "engine/support/StdLibExtras.h"

namespace WTF {

template<typename Container, typename Iterator>
class SizedIteratorRange {
public:
    SizedIteratorRange(const Container& container, Iterator begin, Iterator end)
        : m_container(container)
        , m_begin(begin)
        , m_end(end)
    {
    }

    auto size() const { return m_container.size(); }
    bool isEmpty() const { return m_container.isEmpty(); }
    Iterator begin() const { return m_begin; }
    Iterator end() const { return m_end; }

private:
    const Container& m_container;
    Iterator m_begin;
    Iterator m_end;
};

// Yields a member of what `Iterator` yields.
template<typename Iterator, auto member>
class MemberIterator {
public:
    using reference = decltype(*std::declval<Iterator>().*member);
    using pointer = std::add_pointer_t<reference>;
    using value_type = std::remove_cvref_t<reference>;
    using difference_type = ptrdiff_t;
    using iterator_category = std::forward_iterator_tag;

    MemberIterator() = default;
    MemberIterator(Iterator iterator)
        : m_iterator(iterator)
    {
    }

    reference operator*() const { return *m_iterator.*member; }
    pointer operator->() const { return std::addressof(**this); }

    MemberIterator& operator++()
    {
        ++m_iterator;
        return *this;
    }

    MemberIterator operator++(int) { return m_iterator++; }

    friend bool operator==(const MemberIterator&, const MemberIterator&) = default;

private:
    Iterator m_iterator;
};

}
