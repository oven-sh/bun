#pragma once

#include "root.h"
#include "JSCallbackArgs.h"
#include "helpers.h"
#include "ncrypto.h"

namespace Bun {

struct CheckPrimeJobCtx {
    CheckPrimeJobCtx(ncrypto::BignumPointer candidate, int32_t checks);
    ~CheckPrimeJobCtx();

    void runTask(JSC::JSGlobalObject* lexicalGlobalObject);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject* lexicalGlobalObject);

    int32_t m_checks;
    ncrypto::BignumPointer m_candidate;

    bool m_result { false };
    bool m_failed { false };
};

struct GeneratePrimeJobCtx {
    GeneratePrimeJobCtx(int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint);
    ~GeneratePrimeJobCtx();

    void runTask(JSC::JSGlobalObject* lexicalGlobalObject);
    JSCallbackArgs runFromJS(JSC::JSGlobalObject* lexicalGlobalObject);

    int32_t m_size;
    bool m_safe;
    bool m_bigint;
    ncrypto::BignumPointer m_add;
    ncrypto::BignumPointer m_rem;
    ncrypto::BignumPointer m_prime;
    bool m_failed { false };
    uint32_t m_opensslError { 0 };
};

struct GeneratePrimeJob {
    static JSC::JSValue result(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::BignumPointer& prime, bool bigint);
};

JSC_DECLARE_HOST_FUNCTION(jsCheckPrime);
JSC_DECLARE_HOST_FUNCTION(jsCheckPrimeSync);
JSC_DECLARE_HOST_FUNCTION(jsGeneratePrime);
JSC_DECLARE_HOST_FUNCTION(jsGeneratePrimeSync);

} // namespace Bun
