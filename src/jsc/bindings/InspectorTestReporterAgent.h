#pragma once

#include "root.h"
#include <JavaScriptCore/InspectorAgentBase.h>

namespace Inspector {

class InspectorTestReporterAgent final : public InspectorAgentBase {
    WTF_MAKE_TZONE_ALLOCATED(InspectorTestReporterAgent);

public:
    explicit InspectorTestReporterAgent(JSC::JSGlobalObject&);

    void reportTestFound(int testId, const String& name, ASCIILiteral type, int parentId);
    void reportTestFoundWithLocation(int testId, const String& name, ASCIILiteral type, int parentId, const String& scriptId, const String& sourceURL, int line);
    void reportTestStart(int testId);
    void reportTestEnd(int testId, ASCIILiteral status, double elapsed);

private:
    void didEnable() final;
    void didDisable() final;
};

} // namespace Inspector
