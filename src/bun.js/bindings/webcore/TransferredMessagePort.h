// A MessagePort in transit between contexts. Carried alongside
// SerializedScriptValue (not encoded into the byte stream), so holding a
// live RefPtr to the shared pipe is fine — this never leaves the process.

#pragma once

#include <wtf/RefPtr.h>

namespace WebCore {

class MessagePortPipe;

struct TransferredMessagePort {
    RefPtr<MessagePortPipe> pipe;
    uint8_t side { 0 };

    TransferredMessagePort() = default;
    TransferredMessagePort(RefPtr<MessagePortPipe>&& p, uint8_t s)
        : pipe(WTF::move(p))
        , side(s)
    {
    }
    TransferredMessagePort(TransferredMessagePort&&) = default;
    TransferredMessagePort& operator=(TransferredMessagePort&&) = default;
    TransferredMessagePort(const TransferredMessagePort&) = default;
    TransferredMessagePort& operator=(const TransferredMessagePort&) = default;
};

} // namespace WebCore
