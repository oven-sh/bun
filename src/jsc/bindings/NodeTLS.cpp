#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "libusockets.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "openssl/base.h"
#include "openssl/bio.h"
#include "openssl/err.h"
#include "openssl/x509.h"
#include "../../packages/bun-usockets/src/crypto/root_certs_header.h"

#include <limits>
#include <set>

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(getBundledRootCertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();

    struct us_cert_string_t* out;
    auto size = us_raw_root_certs(&out);
    if (size < 0) {
        return JSValue::encode(jsUndefined());
    }
    auto rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);
    for (auto i = 0; i < size; i++) {
        auto raw = out[i];
        auto str = WTF::String::fromUTF8(std::span { raw.str, raw.len });
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

// Compare by DER encoding so that a cert supplied twice (even via different
// PEM formatting) is deduplicated — matches Node.js's X509Set which hashes
// X509_cmp-equivalent identity.
struct X509DerLess {
    bool operator()(X509* a, X509* b) const
    {
        return X509_cmp(a, b) < 0;
    }
};

// Read every PEM certificate contained in `data` (a single entry may hold a
// bundle). On parse failure, frees anything this call pushed and returns the
// peeked OpenSSL error so the caller can format it.
static unsigned long appendX509sFromPEM(std::span<const uint8_t> data, STACK_OF(X509) * out)
{
    ERR_clear_error();
    // BoringSSL takes ossl_ssize_t (= ptrdiff_t) here; an int cast would
    // truncate a >2GB input and make BoringSSL treat it as NUL-terminated.
    // Guard the upper bound explicitly so a pathological ArrayBufferView
    // byteLength can't wrap to a small positive length.
    if (data.size() > static_cast<size_t>(std::numeric_limits<ossl_ssize_t>::max())) {
        OPENSSL_PUT_ERROR(PEM, PEM_R_BAD_END_LINE);
        return ERR_peek_last_error();
    }
    BIO* bio = BIO_new_mem_buf(data.data(), static_cast<ossl_ssize_t>(data.size()));
    if (bio == nullptr) {
        return ERR_peek_last_error();
    }

    size_t pushed = 0;
    while (X509* x = PEM_read_bio_X509(bio, nullptr, [](char*, int, int, void*) -> int { return 0; }, nullptr)) {
        if (!sk_X509_push(out, x)) {
            X509_free(x);
            BIO_free(bio);
            while (pushed-- > 0)
                X509_free(sk_X509_pop(out));
            OPENSSL_PUT_ERROR(PEM, ERR_R_MALLOC_FAILURE);
            return ERR_peek_last_error();
        }
        pushed++;
    }
    BIO_free(bio);

    unsigned long last = ERR_peek_last_error();
    // PEM_R_NO_START_LINE after at least one successful read just means EOF.
    if (pushed > 0 && ERR_GET_LIB(last) == ERR_LIB_PEM && ERR_GET_REASON(last) == PEM_R_NO_START_LINE) {
        ERR_clear_error();
        return 0;
    }
    if (last != 0) {
        // Roll back everything this call pushed so a mid-array failure leaves
        // the process-wide store untouched.
        while (pushed-- > 0) {
            X509_free(sk_X509_pop(out));
        }
    }
    return last;
}

JSC_DEFINE_HOST_FUNCTION(resetRootCertStore, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue arg = callFrame->argument(0);
    JSArray* array = arg.isCell() ? dynamicDowncast<JSArray>(arg.asCell()) : nullptr;
    // The JS wrapper validated this already; be defensive for direct callers.
    if (!array) [[unlikely]] {
        return throwVMTypeError(globalObject, scope, "Expected an array of certificates"_s);
    }

    unsigned length = array->length();
    if (length == 0) {
        // Explicit empty trust set — subsequent default-CA connections will
        // fail verification. Matches Node.js, which distinguishes "empty
        // override" from "no override".
        us_set_user_root_certs(nullptr);
        return JSValue::encode(jsUndefined());
    }

    STACK_OF(X509)* parsed = sk_X509_new_null();
    if (parsed == nullptr) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto freeParsed = [&]() { sk_X509_pop_free(parsed, X509_free); };

    for (unsigned i = 0; i < length; i++) {
        JSValue element = array->getIndex(globalObject, i);
        if (scope.exception()) [[unlikely]] {
            freeParsed();
            return {};
        }

        unsigned long err = 0;
        if (element.isString()) {
            auto str = element.toWTFString(globalObject);
            if (scope.exception()) [[unlikely]] {
                freeParsed();
                return {};
            }
            auto utf8 = str.utf8();
            err = appendX509sFromPEM({ reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length() }, parsed);
        } else if (auto* view = element.isCell() ? dynamicDowncast<JSArrayBufferView>(element.asCell()) : nullptr) {
            err = appendX509sFromPEM(view->span(), parsed);
        } else {
            // JS validated element types; treat anything else as a failure.
            freeParsed();
            return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to load certificate data"_str);
        }

        if (err != 0) {
            freeParsed();
            char buf[256] = { 0 };
            ERR_error_string_n(err, buf, sizeof(buf));
            ERR_clear_error();
            auto message = makeString("Failed to parse certificate: "_s, String::fromUTF8(buf));
            return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, message);
        }
    }

    if (sk_X509_num(parsed) == 0) {
        freeParsed();
        return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "No valid certificates found in the provided array"_str);
    }

    // Deduplicate by X509 identity so getCACertificates('default') mirrors
    // Node.js's X509Set semantics (and so the store isn't bloated).
    std::set<X509*, X509DerLess> seen;
    STACK_OF(X509)* deduped = sk_X509_new_null();
    if (deduped == nullptr) {
        freeParsed();
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    for (int i = 0; i < (int)sk_X509_num(parsed); i++) {
        X509* cert = sk_X509_value(parsed, i);
        if (seen.insert(cert).second) {
            X509_up_ref(cert);
            if (!sk_X509_push(deduped, cert)) {
                X509_free(cert); // drop the up_ref we just took
                sk_X509_pop_free(deduped, X509_free);
                freeParsed();
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
        }
    }
    freeParsed();

    us_set_user_root_certs(deduped);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(getUserRootCertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Snapshot under the root-cert mutex so another Worker calling
    // setDefaultCACertificates() can't free certs out from under us while
    // we're writing PEM. hasOverride distinguishes "no override installed"
    // (return undefined so the JS side falls back to bundled/system/extra)
    // from "empty override installed" (return a frozen empty array).
    bool hasOverride = false;
    STACK_OF(X509)* certs = us_dup_user_root_certs(&hasOverride);
    if (!hasOverride) {
        return JSValue::encode(jsUndefined());
    }
    auto freeCerts = [&]() {
        if (certs) sk_X509_pop_free(certs, X509_free);
    };
    auto size = certs ? sk_X509_num(certs) : 0;

    JSC::MarkedArgumentBuffer args;
    for (size_t i = 0; i < size; i++) {
        BIO* bio = BIO_new(BIO_s_mem());
        if (!bio) {
            freeCerts();
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        if (PEM_write_bio_X509(bio, sk_X509_value(certs, i)) != 1) {
            BIO_free(bio);
            freeCerts();
            return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "X509 to PEM conversion"_str);
        }
        char* bioData = nullptr;
        long bioLen = BIO_get_mem_data(bio, &bioData);
        if (bioLen <= 0 || !bioData) {
            BIO_free(bio);
            freeCerts();
            return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Reading PEM data"_str);
        }
        auto str = WTF::String::fromUTF8(std::span { bioData, static_cast<size_t>(bioLen) });
        args.append(JSC::jsString(vm, str));
        BIO_free(bio);
    }
    freeCerts();

    if (args.hasOverflowed()) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    auto result = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), args);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::objectConstructorFreeze(globalObject, result)));
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
