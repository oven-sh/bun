#pragma once

#include "root.h"
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
    // Kind::Node: workerData carries the markers that node:worker_threads turns back into FileHandles.
    bool workerDataHasJSTransferables { false };
    // Serialized array containing [workerData, environmentData]
    // (environmentData is always a Map)
    RefPtr<SerializedScriptValue> workerDataAndEnvironmentData;
    // Objects transferred for either data or environmentData in the transferList
    Vector<TransferredMessagePort> dataMessagePorts;
    // Kind::Node: the worker's ends of the channels that node:worker_threads' Worker makes for it. The first three are indexed by fd.
    enum NodePort : uint8_t {
        Stdin,
        Stdout,
        Stderr,
        // postMessageToThread: the port to the main thread's hub
        Hub,
        // parentPort
        Parent,
        NodePortCount,
    };
    // One per NodePort (Stdin has no pipe without { stdin: true }), in transit until the worker's start sequence entangles them. Empty for Kind::Web, and for a worker made in a context that had stopped.
    Vector<TransferredMessagePort> nodePorts;
    Vector<String> preloadModules;
    std::optional<HashMap<String, String>> env;
    Vector<String> argv;
    // If nullopt, inherit execArgv from the parent thread
    std::optional<Vector<String>> execArgv;
};

} // namespace WebCore
