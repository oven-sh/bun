#pragma once
#include <JavaScriptCore/InjectedScriptHost.h>

namespace Bun {

class BunInjectedScriptHost final : public Inspector::InjectedScriptHost {
public:
    static Ref<BunInjectedScriptHost> create() { return adoptRef(*new BunInjectedScriptHost); }

    JSC::JSValue subtype(JSC::JSGlobalObject*, JSC::JSValue) override;
    JSC::JSValue getInternalProperties(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue) override;
    bool isHTMLAllCollection(JSC::VM&, JSC::JSValue) override { return false; }
};

}
