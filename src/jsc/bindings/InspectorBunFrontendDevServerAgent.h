#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/InspectorAgentBase.h>

namespace Inspector {

class InspectorBunFrontendDevServerAgent final : public InspectorAgentBase {
    WTF_MAKE_TZONE_ALLOCATED(InspectorBunFrontendDevServerAgent);

public:
    explicit InspectorBunFrontendDevServerAgent(JSC::JSGlobalObject&);

    void clientConnected(int devServerId, int connectionId);
    void clientDisconnected(int devServerId, int connectionId);
    void bundleStart(int devServerId, Ref<JSON::ArrayOf<String>>&& triggerFiles);
    void bundleComplete(int devServerId, double durationMs);
    void bundleFailed(int devServerId, const String& buildErrorsPayloadBase64);
    void clientNavigated(int devServerId, int connectionId, const String& url, std::optional<int> routeBundleId);
    void consoleLog(int devServerId, char kind, const String& data);

private:
    void didEnable() final;
    void didDisable() final;
};

} // namespace Inspector
