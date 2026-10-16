#pragma once

#include <bun-uws/src/WebSocketProtocol.h>

#include <cstddef>
#include <cstring>
#include <limits>
#include <vector>

namespace Bun {

template<bool isServer, typename Impl,
    std::size_t postPadding = uWS::WebSocketProtocol<isServer, Impl>::CONSUME_POST_PADDING>
class PaddedWebSocketProtocol : public uWS::WebSocketState<isServer> {
    using Protocol = uWS::WebSocketProtocol<isServer, Impl>;

    static_assert(postPadding >= Protocol::CONSUME_POST_PADDING);

    std::vector<char> scratch;

protected:
    std::size_t paddedConsumeMemoryCost() const { return scratch.capacity(); }

    /* Protocol callbacks run synchronously from consumePadded. Implementations
     * must not retain fragment bytes after their callback returns. */
    void consumePadded(const char* data, std::size_t length)
    {
        if (length == 0 || length > std::numeric_limits<unsigned int>::max()) return;

        scratch.resize(Protocol::CONSUME_PRE_PADDING + length + postPadding);
        char* payload = scratch.data() + Protocol::CONSUME_PRE_PADDING;
        std::memcpy(payload, data, length);
        Protocol::consume(payload, static_cast<unsigned int>(length), this, static_cast<Impl*>(this));
    }
};

}
