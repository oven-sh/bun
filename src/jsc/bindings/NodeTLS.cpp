#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "libusockets.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "openssl/base.h"
#include "openssl/base64.h"
#include "openssl/bio.h"
#include "openssl/x509.h"
#include "../../packages/bun-usockets/src/crypto/root_certs_header.h"

namespace Bun {

using namespace JSC;

static constexpr std::string_view kPemBegin = "-----BEGIN CERTIFICATE-----\n";
static constexpr std::string_view kPemEnd = "-----END CERTIFICATE-----";
static constexpr size_t kPemLineWidth = 72;

// Bundled roots are stored as DER so the TLS path can skip PEM parsing;
// re-encode to PEM here for tls.rootCertificates / getCACertificates('bundled').
static WTF::String derToPEMString(const unsigned char* der, size_t derLen)
{
    size_t b64Len;
    if (!EVP_EncodedLength(&b64Len, derLen) || b64Len == 0)
        return {};
    Vector<uint8_t, 2048> b64(b64Len);
    size_t written = EVP_EncodeBlock(b64.mutableSpan().data(), der, derLen);

    size_t newlines = (written + kPemLineWidth - 1) / kPemLineWidth;
    WTF::StringBuilder pem;
    pem.reserveCapacity(kPemBegin.size() + written + newlines + kPemEnd.size());
    pem.append(std::span { kPemBegin });
    for (size_t off = 0; off < written; off += kPemLineWidth) {
        size_t n = std::min(kPemLineWidth, written - off);
        pem.append(std::span { reinterpret_cast<const char*>(b64.span().data()) + off, n });
        pem.append('\n');
    }
    pem.append(std::span { kPemEnd });
    return pem.toString();
}

JSC_DEFINE_HOST_FUNCTION(getBundledRootCertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();

    struct us_cert_der_t* out;
    auto size = us_raw_root_certs(&out);
    if (size < 0) {
        return JSValue::encode(jsUndefined());
    }
    auto rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);
    for (auto i = 0; i < size; i++) {
        auto raw = out[i];
        auto str = derToPEMString(raw.der, raw.len);
        rootCertificates->putDirectIndex(globalObject, i, JSC::jsString(vm, str));
    }

    return JSValue::encode(JSC::objectConstructorFreeze(globalObject, rootCertificates));
}

JSC_DEFINE_HOST_FUNCTION(getExtraCACertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    VM& vm = globalObject->vm();

    STACK_OF(X509)* root_extra_cert_instances = us_get_root_extra_cert_instances();

    auto size = sk_X509_num(root_extra_cert_instances);
    if (size < 0) size = 0; // root_extra_cert_instances is nullptr

    JSC::MarkedArgumentBuffer args;
    for (auto i = 0; i < size; i++) {
        BIO* bio = BIO_new(BIO_s_mem());
        if (!bio) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        if (PEM_write_bio_X509(bio, sk_X509_value(root_extra_cert_instances, i)) != 1) {
            BIO_free(bio);
            return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "X509 to PEM conversion"_str);
        }

        char* bioData = nullptr;
        long bioLen = BIO_get_mem_data(bio, &bioData);
        if (bioLen <= 0 || !bioData) {
            BIO_free(bio);
            return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Reading PEM data"_str);
        }

        auto str = WTF::String::fromUTF8(std::span { bioData, static_cast<size_t>(bioLen) });
        args.append(JSC::jsString(vm, str));
        BIO_free(bio);
    }

    if (args.hasOverflowed()) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto rootCertificates = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), args);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::objectConstructorFreeze(globalObject, rootCertificates)));
}

JSC_DEFINE_HOST_FUNCTION(getSystemCACertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    VM& vm = globalObject->vm();

    STACK_OF(X509)* root_system_cert_instances = us_get_root_system_cert_instances();

    auto size = sk_X509_num(root_system_cert_instances);
    if (size < 0) size = 0; // root_system_cert_instances is nullptr

    JSC::MarkedArgumentBuffer args;
    for (auto i = 0; i < size; i++) {
        BIO* bio = BIO_new(BIO_s_mem());
        if (!bio) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        X509* cert = sk_X509_value(root_system_cert_instances, i);
        if (!cert) {
            BIO_free(bio);
            continue;
        }
        if (!PEM_write_bio_X509(bio, cert)) {
            BIO_free(bio);
            continue;
        }

        char* bioData;
        long bioLen = BIO_get_mem_data(bio, &bioData);
        if (bioLen <= 0) {
            BIO_free(bio);
            continue;
        }

        auto str = WTF::String::fromUTF8(std::span { bioData, static_cast<size_t>(bioLen) });
        args.append(JSC::jsString(vm, str));
        BIO_free(bio);
    }

    if (args.hasOverflowed()) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto rootCertificates = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), args);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::objectConstructorFreeze(globalObject, rootCertificates)));
}

extern "C" JSC::EncodedJSValue Bun__getTLSDefaultCiphers(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
extern "C" JSC::EncodedJSValue Bun__setTLSDefaultCiphers(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

JSC_DEFINE_HOST_FUNCTION(getDefaultCiphers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return Bun__getTLSDefaultCiphers(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(setDefaultCiphers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return Bun__setTLSDefaultCiphers(globalObject, callFrame);
}

} // namespace Bun
