#pragma once

#include "engine/support/Assertions.h"
#include "engine/support/Noncopyable.h"

namespace WTF {

template<typename T, typename Node> class SentinelLinkedList;

// The base of an object that is on at most one list, and takes itself off without knowing which.
template<typename T>
class BasicRawSentinelNode {
public:
    bool isOnList() const { return m_next; }

    void remove()
    {
        ASSERT(isOnList());
        m_previous->m_next = m_next;
        m_next->m_previous = m_previous;
        m_previous = nullptr;
        m_next = nullptr;
    }

private:
    friend class SentinelLinkedList<T, BasicRawSentinelNode>;

    BasicRawSentinelNode* m_next { nullptr };
    BasicRawSentinelNode* m_previous { nullptr };
};

template<typename T, typename Node>
class SentinelLinkedList {
    WTF_MAKE_NONCOPYABLE(SentinelLinkedList);

public:
    class iterator {
    public:
        explicit iterator(Node* node)
            : m_node(node)
        {
        }

        T& operator*() const { return *operator->(); }
        T* operator->() const { return static_cast<T*>(m_node); }

        iterator& operator++()
        {
            m_node = next(m_node);
            return *this;
        }

        friend bool operator==(iterator, iterator) = default;

    private:
        Node* m_node;
    };

    SentinelLinkedList()
    {
        m_sentinel.m_next = &m_sentinel;
        m_sentinel.m_previous = &m_sentinel;
    }

    bool isEmpty() const { return m_sentinel.m_next == &m_sentinel; }

    iterator begin() LIFETIME_BOUND { return iterator { m_sentinel.m_next }; }
    iterator end() LIFETIME_BOUND { return iterator { &m_sentinel }; }

    void append(T* object)
    {
        Node* node = object;
        ASSERT(!node->isOnList());
        node->m_previous = m_sentinel.m_previous;
        node->m_next = &m_sentinel;
        m_sentinel.m_previous->m_next = node;
        m_sentinel.m_previous = node;
    }

private:
    static Node* next(Node* node) { return node->m_next; }

    Node m_sentinel;
};

}

using WTF::BasicRawSentinelNode;
using WTF::SentinelLinkedList;
