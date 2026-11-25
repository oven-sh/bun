#pragma once

#include "root.h"
#include "JSCallbackArgs.h"
#include "ncrypto.h"

namespace Bun {

struct SecretKeyJobCtx {
    SecretKeyJobCtx(size_t length);
    SecretKeyJobCtx(SecretKeyJobCtx&&);
    ~SecretKeyJobCtx() = default;

    void runTask(JSC::JSGlobalObject* lexicalGlobalObject);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject* lexicalGlobalObject);

    static std::optional<SecretKeyJobCtx> fromJS(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue typeValue, JSC::JSValue optionsValue);
    JSC::JSValue result() const;

    size_t m_length;

    std::optional<WTF::Vector<uint8_t>> m_result { std::nullopt };
};

JSC_DECLARE_HOST_FUNCTION(jsGenerateKey);
JSC_DECLARE_HOST_FUNCTION(jsGenerateKeySync);

} // namespace Bun
