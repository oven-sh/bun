#pragma once

#include "root.h"

#include "BunClientData.h"
#include "ncrypto.h"
#include "headers-handwritten.h"

#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/WriteBarrier.h>
#include "KeyObject.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsIsX509Certificate);

using namespace JSC;

class JSX509Certificate final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    // The underlying X509 certificate
    ncrypto::X509Pointer m_x509;

    ncrypto::X509View view() const
    {
        return m_x509.view();
    }

    // Certificate data computed on first access. A getter that throws caches nothing, so the next access
    // computes (and throws) again rather than handing out a stale placeholder. An absent subject / issuer is
    // cached as the empty string; an absent subjectAltName as null.
    WriteBarrier<JSString> m_subject;
    WriteBarrier<JSString> m_issuer;
    WriteBarrier<JSString> m_validFrom;
    WriteBarrier<JSString> m_validTo;
    WriteBarrier<JSString> m_serialNumber;
    WriteBarrier<JSString> m_fingerprint;
    WriteBarrier<JSString> m_fingerprint256;
    WriteBarrier<JSString> m_fingerprint512;
    WriteBarrier<JSUint8Array> m_raw;
    WriteBarrier<Unknown> m_subjectAltName;
    WriteBarrier<JSObject> m_publicKey;

    JSString* subject(JSGlobalObject*);
    JSString* issuer(JSGlobalObject*);
    JSString* validFrom(JSGlobalObject*);
    JSString* validTo(JSGlobalObject*);
    JSString* serialNumber(JSGlobalObject*);
    JSString* fingerprint(JSGlobalObject*);
    JSString* fingerprint256(JSGlobalObject*);
    JSString* fingerprint512(JSGlobalObject*);
    JSUint8Array* raw(JSGlobalObject*);
    // The string, or null when the certificate has no subjectAltName extension.
    JSValue subjectAltName(JSGlobalObject*);
    JSObject* publicKey(JSGlobalObject*);

    // Certificate validation methods
    // `peerName`, when provided, receives the subject name that matched, which
    // can differ from the queried host (wildcard SANs, case-insensitive matches).
    bool checkHost(JSGlobalObject*, std::span<const char>, uint32_t flags, ncrypto::DataPointer* peerName = nullptr);
    bool checkEmail(JSGlobalObject*, std::span<const char>, uint32_t flags);
    bool checkIP(JSGlobalObject*, const char*);
    bool checkIssued(JSGlobalObject*, JSX509Certificate* issuer);
    bool checkPrivateKey(const KeyObject&);
    bool verify(const KeyObject&);
    JSC::JSObject* toLegacyObject(JSGlobalObject*);
    static JSObject* toLegacyObject(ncrypto::X509View view, JSGlobalObject*);

    // Certificate data access methods
    static JSValue getKeyUsage(ncrypto::X509View view, JSGlobalObject*);
    JSValue getKeyUsage(JSGlobalObject* globalObject) { return JSX509Certificate::getKeyUsage(view(), globalObject); }

    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);

    static void destroy(JSC::JSCell*);

    ~JSX509Certificate();

    void finishCreation(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSValue prototype);

    static JSX509Certificate* create(
        JSC::VM& vm,
        JSC::Structure* structure);

    static JSX509Certificate* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSC::JSGlobalObject* globalObject,
        std::span<const uint8_t> data);

    static JSX509Certificate* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSC::JSGlobalObject* globalObject,
        ncrypto::X509Pointer&& cert);

    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename Visitor>
    static void visitChildren(JSCell*, Visitor&);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSX509Certificate, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSX509Certificate, m_subspaceForJSX509Certificate));
    }

    static JSValue computeSubject(ncrypto::X509View view, JSGlobalObject*, bool legacy);
    static JSValue computeIssuer(ncrypto::X509View view, JSGlobalObject*, bool legacy);
    static JSString* computeValidFrom(ncrypto::X509View view, JSGlobalObject*);
    static JSString* computeValidTo(ncrypto::X509View view, JSGlobalObject*);
    static JSString* computeSerialNumber(ncrypto::X509View view, JSGlobalObject*);
    static JSString* computeFingerprint(ncrypto::X509View view, JSGlobalObject*);
    static JSString* computeFingerprint256(ncrypto::X509View view, JSGlobalObject*);
    static JSString* computeFingerprint512(ncrypto::X509View view, JSGlobalObject*);
    static JSUint8Array* computeRaw(ncrypto::X509View view, JSGlobalObject*);
    static bool computeIsCA(ncrypto::X509View view, JSGlobalObject*);
    static JSValue computeInfoAccess(ncrypto::X509View view, JSGlobalObject*);
    static JSString* computeSubjectAltName(ncrypto::X509View view, JSGlobalObject*);
    static JSObject* computePublicKey(ncrypto::X509View view, JSGlobalObject*);

    JSX509Certificate(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    // Convert the certificate to PEM format
    String toPEMString() const;

private:
    uint16_t m_extraMemorySizeForGC = 0;
};

void setupX509CertificateClassStructure(LazyClassStructure::Initializer& init);

} // namespace Bun
