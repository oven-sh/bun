#pragma once

#include "root.h"
#include "SerializedScriptValue.h"
#include "MessagePort.h"

namespace WebCore {

struct BunOptions {
    bool mini { false };
    bool unref { false };
    RefPtr<SerializedScriptValue> data;
    Vector<RefPtr<MessagePort>> dataMessagePorts;
};

struct WorkerOptions {
    // WorkerType type { WorkerType::Classic };
    // FetchRequestCredentials credentials { FetchRequestCredentials::SameOrigin };
    String name;

    BunOptions bun {};
};

} // namespace WebCore
