#pragma once

#include "root.h"
#include "helpers.h"
#include "ncrypto.h"

using namespace JSC;
using namespace Bun;

struct CheckPrimeJobCtx {
    CheckPrimeJobCtx(ncrypto::BignumPointer candidate, int32_t checks);
    ~CheckPrimeJobCtx();

    void runTask(JSGlobalObject* lexicalGlobalObject);
    void runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback);
    void deinit();

    int32_t m_checks;
    ncrypto::BignumPointer m_candidate;

    bool m_result { false };

    WTF_MAKE_TZONE_ALLOCATED(CheckPrimeJobCtx);
};

// Opaque struct created zig land
struct CheckPrimeJob {
    static CheckPrimeJob* create(JSGlobalObject*, ncrypto::BignumPointer candidate, int32_t checks, JSValue callback);
    static void createAndSchedule(JSGlobalObject* globalObject, ncrypto::BignumPointer candidate, int32_t checks, JSValue callback);

    void schedule();
};

struct GeneratePrimeJobCtx {
    GeneratePrimeJobCtx(int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint);
    ~GeneratePrimeJobCtx();

    void runTask(JSGlobalObject* lexicalGlobalObject);
    void runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback);
    void deinit();

    int32_t m_size;
    bool m_safe;
    bool m_bigint;
    ncrypto::BignumPointer m_add;
    ncrypto::BignumPointer m_rem;
    ncrypto::BignumPointer m_prime;

    WTF_MAKE_TZONE_ALLOCATED(GeneratePrimeJobCtx);
};

// Opaque struct created zig land
struct GeneratePrimeJob {
    static GeneratePrimeJob* create(JSGlobalObject*, int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint, JSValue callback);
    static void createAndSchedule(JSGlobalObject*, int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint, JSValue callback);

    void schedule();
};

JSC_DECLARE_HOST_FUNCTION(jsCheckPrime);
JSC_DECLARE_HOST_FUNCTION(jsCheckPrimeSync);
JSC_DECLARE_HOST_FUNCTION(jsGeneratePrime);
JSC_DECLARE_HOST_FUNCTION(jsGeneratePrimeSync);
