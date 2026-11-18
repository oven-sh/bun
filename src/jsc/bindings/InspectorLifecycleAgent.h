#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/InspectorAgentBase.h>

namespace Inspector {

class InspectorLifecycleAgent final : public InspectorAgentBase {
    WTF_MAKE_TZONE_ALLOCATED(InspectorLifecycleAgent);

public:
    explicit InspectorLifecycleAgent(JSC::JSGlobalObject&);

    void reportError(ZigException&);

private:
    void didEnable() final;
    void didDisable() final;
    std::optional<CommandResult> runCommand(StringView) final;
    CommandResult getModuleGraph();
};

} // namespace Inspector
