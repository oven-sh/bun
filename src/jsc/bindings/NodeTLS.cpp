#include "root.h"

#include <limits>

#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "libusockets.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "openssl/base.h"
#include "openssl/bio.h"
#include "openssl/err.h"
#include "openssl/pem.h"
#include "openssl/x509.h"
#include "../../packages/bun-usockets/src/crypto/root_certs_header.h"

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

static int noPasswordCallback(char*, int, int, void*)
{
    return 0;
}

struct ClearErrorOnReturn {
    ~ClearErrorOnReturn() { ERR_clear_error(); }
};

JSC_DEFINE_HOST_FUNCTION(parseCACertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ClearErrorOnReturn clearErrorOnReturn;

    auto* certs = dynamicDowncast<JSC::JSArray>(callFrame->argument(0));
    if (!certs) {
        return throwVMTypeError(globalObject, scope, "expected an array of certificates"_s);
    }

    JSC::MarkedArgumentBuffer results;
    WTF::HashSet<WTF::String> seen;
    unsigned length = certs->length();

    for (unsigned i = 0; i < length; i++) {
        JSValue element = certs->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::CString utf8;
        const void* data = nullptr;
        size_t size = 0;
        if (element.isString()) {
            auto string = element.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            utf8 = string.utf8();
            data = utf8.data();
            size = utf8.length();
        } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(element)) {
            if (view->isDetached()) {
                return throwVMTypeError(globalObject, scope, "certificate buffer is detached"_s);
            }
            data = view->vector();
            size = view->byteLength();
        } else {
            return throwVMTypeError(globalObject, scope, "expected a string or ArrayBufferView"_s);
        }

        if (size > static_cast<size_t>(std::numeric_limits<int>::max())) {
            return throwVMTypeError(globalObject, scope, "certificate is too large"_s);
        }

        ERR_clear_error();
        BIO* bio = BIO_new_mem_buf(data, static_cast<int>(size));
        if (!bio) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        while (X509* x509 = PEM_read_bio_X509(bio, nullptr, noPasswordCallback, nullptr)) {
            BIO* out = BIO_new(BIO_s_mem());
            if (!out) {
                X509_free(x509);
                BIO_free(bio);
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            bool wrote = PEM_write_bio_X509(out, x509) == 1;
            X509_free(x509);
            if (!wrote) {
                BIO_free(out);
                BIO_free(bio);
                ERR_clear_error();
                return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "X509 to PEM conversion"_str);
            }

            char* outData = nullptr;
            long outLen = BIO_get_mem_data(out, &outData);
            if (outLen <= 0 || !outData) {
                BIO_free(out);
                BIO_free(bio);
                return throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Reading PEM data"_str);
            }
            auto pem = WTF::String::fromUTF8(std::span { outData, static_cast<size_t>(outLen) });
            BIO_free(out);

            if (seen.add(pem).isNewEntry) {
                results.append(JSC::jsString(vm, pem));
                if (results.hasOverflowed()) {
                    BIO_free(bio);
                    throwOutOfMemoryError(globalObject, scope);
                    return {};
                }
            }
        }
        BIO_free(bio);

        unsigned long err = ERR_peek_last_error();
        if (err != 0 && !(ERR_GET_LIB(err) == ERR_LIB_PEM && ERR_GET_REASON(err) == PEM_R_NO_START_LINE)) {
            const char* reason = ERR_reason_error_string(err);
            char buffer[256];
            ERR_error_string_n(err, buffer, sizeof(buffer));
            int lib = ERR_GET_LIB(err);
            ERR_clear_error();

            ASCIILiteral libName = [&]() -> ASCIILiteral {
                switch (lib) {
                case ERR_LIB_PEM:
                    return "PEM"_s;
                case ERR_LIB_ASN1:
                    return "ASN1"_s;
                case ERR_LIB_X509:
                    return "X509"_s;
                case ERR_LIB_EVP:
                    return "EVP"_s;
                case ERR_LIB_BIO:
                    return "BIO"_s;
                case ERR_LIB_CRYPTO:
                    return "CRYPTO"_s;
                case ERR_LIB_BUF:
                    return "BUF"_s;
                case ERR_LIB_OBJ:
                    return "OBJ"_s;
                case ERR_LIB_BN:
                    return "BN"_s;
                case ERR_LIB_EC:
                    return "EC"_s;
                case ERR_LIB_RSA:
                    return "RSA"_s;
                case ERR_LIB_DSA:
                    return "DSA"_s;
                case ERR_LIB_DH:
                    return "DH"_s;
                default:
                    return {};
                }
            }();

            WTF::String code;
            if (reason) {
                auto upper = makeStringByReplacingAll(WTF::String::fromUTF8(reason).convertToASCIIUppercase(), ' ', '_');
                code = libName.isNull() ? makeString("ERR_OSSL_"_s, upper) : makeString("ERR_OSSL_"_s, libName, '_', upper);
            } else {
                code = "ERR_CRYPTO_OPERATION_FAILED"_s;
            }

            auto* error = JSC::createError(globalObject, WTF::String::fromUTF8(buffer));
            error->putDirect(vm, JSC::Identifier::fromString(vm, "code"_s), JSC::jsString(vm, code), 0);
            throwException(globalObject, scope, error);
            return {};
        }
        ERR_clear_error();
    }

    auto* array = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), results);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(array));
}

// Rust side is #[host_fn(export = ...)] which emits extern "sysv64" on
// win-x64; BUN_DECLARE_HOST_FUNCTION carries SYSV_ABI so both sides agree.
BUN_DECLARE_HOST_FUNCTION(Bun__getTLSDefaultCiphers);
BUN_DECLARE_HOST_FUNCTION(Bun__setTLSDefaultCiphers);

JSC_DEFINE_HOST_FUNCTION(getDefaultCiphers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return Bun__getTLSDefaultCiphers(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(setDefaultCiphers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return Bun__setTLSDefaultCiphers(globalObject, callFrame);
}

} // namespace Bun
