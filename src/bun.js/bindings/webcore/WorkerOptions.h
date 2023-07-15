#pragma once

#include "root.h"

namespace WebCore {

struct WorkerOptions {
    // WorkerType type { WorkerType::Classic };
    // FetchRequestCredentials credentials { FetchRequestCredentials::SameOrigin };
    String name;
};

} // namespace WebCore
