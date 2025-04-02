#pragma once

#include "root.h"
#include "SerializedScriptValue.h"
#include "TransferredMessagePort.h"
#include "MessagePort.h"

namespace WebCore {

struct WorkerOptions {
    String name;
    bool mini { false };
    bool unref { false };
    // Most of our code doesn't care whether `eval` was passed, because worker_threads.ts
    // automatically passes a Blob URL instead of a file path if `eval` is true. But, if `eval` is
    // true, then we need to make sure that `process.argv` contains "[worker eval]" instead of the
    // Blob URL.
    bool evalMode { false };
    RefPtr<SerializedScriptValue> data;
    Vector<TransferredMessagePort> dataMessagePorts;
    Vector<String> preloadModules;
    std::optional<HashMap<String, String>> env; // TODO(@190n) allow shared
    Vector<String> argv;
    // If nullopt, inherit execArgv from the parent thread
    std::optional<Vector<String>> execArgv;
};

} // namespace WebCore
