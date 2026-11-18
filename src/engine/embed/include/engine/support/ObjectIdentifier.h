#pragma once

#include "engine/support/Assertions.h"
#include "engine/support/Forward.h"

#include <atomic>

namespace WTF {

// A number other than zero that cannot be taken for the identifier of another kind of object.
template<typename Kind>
class ObjectIdentifier {
public:
    explicit constexpr ObjectIdentifier(uint64_t identifier)
        : m_identifier(identifier)
    {
        RELEASE_ASSERT(identifier);
    }

    static ObjectIdentifier generate()
    {
        static std::atomic<uint64_t> last;
        return ObjectIdentifier(++last);
    }

    constexpr uint64_t toUInt64() const { return m_identifier; }

    friend constexpr bool operator==(ObjectIdentifier, ObjectIdentifier) = default;

private:
    uint64_t m_identifier;
};

}

using WTF::ObjectIdentifier;
