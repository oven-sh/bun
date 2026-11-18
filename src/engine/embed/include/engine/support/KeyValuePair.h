#pragma once

#include "engine/support/FastMalloc.h"

namespace WTF {

template<typename Key, typename Value>
struct KeyValuePair {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(KeyValuePair);

    using KeyType = Key;
    using ValueType = Value;

    KeyValuePair() {}

    KeyValuePair(Key&& key, Value&& value)
        : key(WTF::move(key))
        , value(WTF::move(value))
    {
    }

    template<typename K, typename V>
    KeyValuePair(K&& key, V&& value)
        : key(std::forward<K>(key))
        , value(std::forward<V>(value))
    {
    }

    template<typename K, typename V>
    KeyValuePair(KeyValuePair<K, V>&& other)
        : key(std::forward<K>(other.key))
        , value(std::forward<V>(other.value))
    {
    }

    friend bool operator==(const KeyValuePair& a, const KeyValuePair& b) { return a.key == b.key && a.value == b.value; }

    Key key;
    Value value {};
};

template<typename K, typename V>
inline KeyValuePair<std::decay_t<K>, std::decay_t<V>> makeKeyValuePair(K&& key, V&& value)
{
    return { std::forward<K>(key), std::forward<V>(value) };
}

}

using WTF::KeyValuePair;
