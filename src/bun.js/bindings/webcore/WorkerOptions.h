#pragma once

#include "root.h"

namespace WebCore {

struct BunOptions {
    bool mini { false };
    bool unref { false };
};

struct WorkerOptions {
    // WorkerType type { WorkerType::Classic };
    // FetchRequestCredentials credentials { FetchRequestCredentials::SameOrigin };
    String name;

    BunOptions bun {};
};

} // namespace WebCore
