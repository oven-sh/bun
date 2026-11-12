#pragma once

#include "root.h"
#include <array>
#include "SerializedScriptValue.h"
#include "SharedEnvStore.h"
#include "TransferredMessagePort.h"
#include "MessagePort.h"

namespace WebCore {

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
    // Kind::Node: the worker's ends of the channels that node:worker_threads' Worker makes for it, in the order
    // in which the worker hears them (Node reads its internal port, which carries stdio, ahead of the others).
    enum NodePort : uint8_t {
        // process.stdin, process.stdout and process.stderr
        Stdio,
        // parentPort
        Parent,
        // postMessageToThread: the port to the main thread's hub
        Hub,
        NodePortCount,
    };
    // In transit until the worker's start sequence entangles them. Without a pipe for a Web Worker, and for a
    // worker that was made in a context that had stopped.
    std::array<TransferredMessagePort, NodePortCount> nodePorts;
    // Kind::Node: `{ stdin: true }`. Without it the worker's process.stdin has ended.
    bool nodeStdin { false };
    Vector<String> preloadModules;
    std::optional<HashMap<String, String>> env;
    Vector<String> argv;
    // If nullopt, inherit execArgv from the parent thread
    std::optional<Vector<String>> execArgv;
};

} // namespace WebCore
