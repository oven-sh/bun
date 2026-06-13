#pragma once

#include "root.h"
#include "SerializedScriptValue.h"
#include "TransferredMessagePort.h"
#include "MessagePort.h"

namespace WebCore {

// Node's `resourceLimits` worker option. Bun does not enforce these limits
// (JSC has no V8-style per-context heap cap), but they are surfaced through
// `worker.resourceLimits` and the module-level `resourceLimits` export inside
// the worker so the documented API shape matches Node. Each field is nullopt
// when the user did not pass it; worker_threads.ts fills in Node's defaults.
struct WorkerResourceLimits {
    std::optional<double> maxYoungGenerationSizeMb;
    std::optional<double> maxOldGenerationSizeMb;
    std::optional<double> codeRangeSizeMb;
    std::optional<double> stackSizeMb;
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
    std::optional<HashMap<String, String>> env; // TODO(@190n) allow shared
    Vector<String> argv;
    // If nullopt, inherit execArgv from the parent thread
    std::optional<Vector<String>> execArgv;
    WorkerResourceLimits resourceLimits;
};

} // namespace WebCore
