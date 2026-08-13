#pragma once

#include "root.h"
#include "SerializedScriptValue.h"
#include "SharedEnvStore.h"
#include "TransferredMessagePort.h"
#include "MessagePort.h"

namespace WebCore {

// node:worker_threads resourceLimits (-1 = not set, as in Node). JSC has a single heap per VM, so the generation sizes together cap the heap size after each full collection; the other two are only reported back.
struct WorkerResourceLimits {
    double maxYoungGenerationSizeMb { -1 };
    double maxOldGenerationSizeMb { -1 };
    double codeRangeSizeMb { -1 };
    double stackSizeMb { 4 };

    // 0 when no heap limit is configured.
    size_t heapLimitBytes() const
    {
        if (!(maxOldGenerationSizeMb > 0) || !std::isfinite(maxOldGenerationSizeMb))
            return 0;
        double mb = maxOldGenerationSizeMb;
        if (maxYoungGenerationSizeMb > 0 && std::isfinite(maxYoungGenerationSizeMb))
            mb += maxYoungGenerationSizeMb;
        double bytes = mb * 1024.0 * 1024.0;
        // Casting a double beyond size_t's range is undefined behaviour.
        if (bytes >= static_cast<double>(std::numeric_limits<size_t>::max()))
            return std::numeric_limits<size_t>::max();
        return static_cast<size_t>(bytes);
    }
};

struct WorkerOptions {
    enum class Kind : uint8_t {
        // Created by the global Worker constructor
        Web,
        // Created by the `require("node:worker_threads").Worker` constructor
        Node,
    };

    String name;
    bool mini { false };
    bool unref { false };
    // worker_threads `env: SHARE_ENV`: the environment tree resolved on the parent
    // thread, which this worker joins instead of receiving an env snapshot.
    RefPtr<Bun::SharedEnvStore> sharedEnvStore;
    // Most of our code doesn't care whether `eval` was passed, because worker_threads.ts
    // automatically passes a Blob URL instead of a file path if `eval` is true. But, if `eval` is
    // true, then we need to make sure that `process.argv` contains "[worker eval]" instead of the
    // Blob URL.
    bool evalMode { false };
    Kind kind { Kind::Web };
    // Serialized array containing [workerData, environmentData]
    // (environmentData is always a Map)
    RefPtr<SerializedScriptValue> workerDataAndEnvironmentData;
    // Objects transferred for either data or environmentData in the transferList
    Vector<TransferredMessagePort> dataMessagePorts;
    Vector<String> preloadModules;
    std::optional<HashMap<String, String>> env;
    Vector<String> argv;
    // If nullopt, inherit execArgv from the parent thread
    std::optional<Vector<String>> execArgv;
    // Defaults (no heap limit) when no resourceLimits object was passed.
    WorkerResourceLimits resourceLimits;
};

} // namespace WebCore
