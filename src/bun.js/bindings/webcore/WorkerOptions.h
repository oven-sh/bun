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
    RefPtr<SerializedScriptValue> data;
    Vector<TransferredMessagePort> dataMessagePorts;
    Vector<String> preloadModules;
    std::optional<HashMap<String, String>> env; // TODO(@190n) allow shared
    Vector<String> argv;
    // If nullopt, inherit execArgv from the parent thread
    std::optional<Vector<String>> execArgv;
};

} // namespace WebCore
