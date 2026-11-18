#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"

#include <bit>
#include <initializer_list>

namespace WTF {

// A set of enumerators, each of which is one bit.
template<typename E>
class OptionSet {
    WTF_MAKE_TZONE_ALLOCATED(OptionSet);

public:
    using StorageType = std::make_unsigned_t<std::underlying_type_t<E>>;

    static constexpr OptionSet fromRaw(StorageType bits)
    {
        OptionSet result;
        result.m_storage = bits;
        return result;
    }

    constexpr OptionSet() = default;

    constexpr OptionSet(E option)
        : m_storage(static_cast<StorageType>(option))
    {
        ASSERT(!m_storage || std::has_single_bit(m_storage));
    }

    constexpr OptionSet(std::initializer_list<E> options)
    {
        for (E option : options)
            add(option);
    }

    constexpr StorageType toRaw() const { return m_storage; }
    constexpr bool isEmpty() const { return !m_storage; }

    constexpr bool contains(E option) const { return containsAny(option); }
    constexpr bool containsAny(OptionSet other) const { return m_storage & other.m_storage; }

    constexpr void add(OptionSet other) { m_storage |= other.m_storage; }
    constexpr void remove(OptionSet other) { m_storage &= ~other.m_storage; }

    constexpr void set(OptionSet other, bool value)
    {
        if (value)
            add(other);
        else
            remove(other);
    }

    friend constexpr bool operator==(const OptionSet&, const OptionSet&) = default;

private:
    StorageType m_storage { 0 };
};

}

using WTF::OptionSet;
