#pragma once

#include "engine/support/HashMap.h"

namespace WTF {

// Counts how often each value has been added.
template<typename T, typename Hash, typename Traits>
class HashCountedSet final {
    WTF_MAKE_TZONE_ALLOCATED(HashCountedSet);

    using Map = HashMap<T, unsigned, Hash, Traits>;

public:
    using AddResult = typename Map::AddResult;

    unsigned size() const { return m_counts.size(); }

    auto begin() const LIFETIME_BOUND { return m_counts.begin(); }
    auto end() const LIFETIME_BOUND { return m_counts.end(); }

    AddResult add(const T& value, unsigned count = 1)
    {
        auto result = m_counts.add(value, 0);
        result.iterator->value += count;
        return result;
    }

private:
    Map m_counts;
};

}

using WTF::HashCountedSet;
