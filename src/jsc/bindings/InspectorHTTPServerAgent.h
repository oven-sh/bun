#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/InspectorAgentBase.h>

namespace Inspector {

class InspectorHTTPServerAgent final : public InspectorAgentBase {
    WTF_MAKE_TZONE_ALLOCATED(InspectorHTTPServerAgent);

public:
    explicit InspectorHTTPServerAgent(JSC::JSGlobalObject&);

    void serverStarted(int serverId, const String& url, double startTime);
    void serverStopped(int serverId, double timestamp);
    void serverRoutesUpdated(int serverId, int hotReloadId, Ref<JSON::Array>&& routes);

private:
    void didEnable() final;
    void didDisable() final;
};

} // namespace Inspector
