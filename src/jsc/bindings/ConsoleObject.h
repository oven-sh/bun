#pragma once

#include "root.h"

#include <JavaScriptCore/ConsoleClient.h>
#include <wtf/text/WTFString.h>

namespace Bun {
using namespace JSC;

class ConsoleObject final : public JSC::ConsoleClient {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ConsoleObject);

private:
    void messageWithTypeAndLevel(MessageType, MessageLevel, JSC::JSGlobalObject*, const ArgList&) final;
    void count(JSC::JSGlobalObject*, const String& label) final;
    void countReset(JSC::JSGlobalObject*, const String& label) final;
    void profile(JSC::JSGlobalObject*, const String& title) final;
    void profileEnd(JSC::JSGlobalObject*, const String& title) final;
    void takeHeapSnapshot(JSC::JSGlobalObject*, const String& title) final;
    void time(JSC::JSGlobalObject*, const String& label) final;
    void timeLog(JSC::JSGlobalObject*, const String& label, const ArgList&) final;
    void timeEnd(JSC::JSGlobalObject*, const String& label) final;
};

} // namespace Zig
