#pragma once

#include "engine/support/HashFunctions.h"
#include "engine/support/HashTable.h"

namespace WTF {

// A set in the order of insertion. Its elements never move, and an iterator lasts as long as its element.
template<typename T, typename Hash>
class TRIVIAL_ABI ListHashSet final {
    WTF_MAKE_TZONE_ALLOCATED(ListHashSet);

    struct Node {
        WTF_MAKE_STRUCT_TZONE_ALLOCATED(Node);

        Node* previous;
        Node* next;
        unsigned hash;
        T value;
    };

    template<typename Element>
    class Iterator {
    public:
        using iterator_category = std::forward_iterator_tag;
        using value_type = T;
        using difference_type = ptrdiff_t;
        using pointer = Element*;
        using reference = Element&;

        Iterator(Node* node = nullptr)
            : m_node(node)
        {
        }

        Element& operator*() const { return m_node->value; }
        Element* operator->() const { return std::addressof(m_node->value); }

        Iterator& operator++()
        {
            m_node = m_node->next;
            return *this;
        }

        Iterator operator++(int) { return std::exchange(m_node, m_node->next); }

        friend bool operator==(const Iterator&, const Iterator&) = default;

    private:
        Node* m_node;
    };

    template<typename V> using RawPointer = const typename GetPtrHelper<V>::UnderlyingType*;

public:
    using ValueType = T;
    using iterator = Iterator<T>;
    using const_iterator = Iterator<const T>;
    using AddResult = Detail::HashTableAddResult<iterator>;

    ListHashSet() = default;

    ListHashSet(const ListHashSet& other)
    {
        for (auto& value : other)
            add(value);
    }

    ListHashSet(ListHashSet&& other) { swap(other); }

    ~ListHashSet()
    {
        for (Node* node = m_first; node;)
            delete std::exchange(node, node->next);
    }

    ListHashSet& operator=(const ListHashSet& other) { return *this = ListHashSet(other); }

    ListHashSet& operator=(ListHashSet&& other)
    {
        ListHashSet moved(WTF::move(other));
        swap(moved);
        return *this;
    }

    void swap(ListHashSet& other)
    {
        m_nodes.swap(other.m_nodes);
        std::swap(m_first, other.m_first);
        std::swap(m_last, other.m_last);
    }

    unsigned size() const { return m_nodes.size(); }
    unsigned capacity() const { return m_nodes.capacity(); }
    bool isEmpty() const { return !m_first; }

    iterator begin() LIFETIME_BOUND { return m_first; }
    iterator end() LIFETIME_BOUND { return {}; }
    const_iterator begin() const LIFETIME_BOUND { return m_first; }
    const_iterator end() const LIFETIME_BOUND { return {}; }

    T& first() LIFETIME_BOUND
    {
        RELEASE_ASSERT(m_first);
        return m_first->value;
    }

    T& last() LIFETIME_BOUND
    {
        RELEASE_ASSERT(m_last);
        return m_last->value;
    }

    bool contains(const T& value) const { return m_nodes.template lookup<ByValue>(value); }
    template<SmartPtr V = T> bool contains(RawPointer<V> value) const { return m_nodes.template lookup<ByValue>(value); }

    AddResult add(const T& value) LIFETIME_BOUND { return append(value); }
    AddResult add(T&& value) LIFETIME_BOUND { return append(WTF::move(value)); }

    bool remove(const T& value) { return removeEntry(m_nodes.template lookup<ByValue>(value)); }
    template<SmartPtr V = T> bool remove(RawPointer<V> value) { return removeEntry(m_nodes.template lookup<ByValue>(value)); }

    void removeIf(const Invocable<bool(T&)> auto& matches)
    {
        for (Node* node = m_first; node;) {
            Node* current = std::exchange(node, node->next);
            if (matches(current->value))
                removeEntry(m_nodes.template lookup<ByNode>(current));
        }
    }

    T takeFirst()
    {
        T result = WTF::move(first());
        removeEntry(m_nodes.template lookup<ByNode>(m_first));
        return result;
    }

    void clear() { ListHashSet old(WTF::move(*this)); }

private:
    struct ByNode {
        static Node* extract(Node* node) { return node; }
        static unsigned hash(const Node* node) { return node->hash; }
        static bool equal(const Node* a, const Node* b) { return a == b; }
    };

    struct ByValue {
        static unsigned hash(const auto& value) { return Hash::hash(value); }
        static bool equal(const Node* node, const auto& value) { return Hash::equal(node->value, value); }
    };

    template<typename V>
    AddResult append(V&& value)
    {
        auto insertion = m_nodes.template add<ByValue>(value, [&](Node** slot, unsigned hash) {
            *slot = new Node { m_last, nullptr, hash, std::forward<V>(value) };
        });
        Node* node = *insertion.entry;
        if (insertion.isNewEntry) {
            (m_last ? m_last->next : m_first) = node;
            m_last = node;
        }
        return { node, insertion.isNewEntry };
    }

    bool removeEntry(Node** entry)
    {
        if (!entry)
            return false;
        Node* node = *entry;
        m_nodes.remove(entry);
        (node->previous ? node->previous->next : m_first) = node->next;
        (node->next ? node->next->previous : m_last) = node->previous;
        delete node;
        return true;
    }

    Detail::HashTable<Node*, ByNode> m_nodes;
    Node* m_first { nullptr };
    Node* m_last { nullptr };
};

}

using WTF::ListHashSet;
