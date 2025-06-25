#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "libusockets.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "openssl/base.h"
#include "openssl/bio.h"
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

    auto rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);
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
        rootCertificates->putDirectIndex(globalObject, i, JSC::jsString(vm, str));
        BIO_free(bio);
    }

    return JSValue::encode(JSC::objectConstructorFreeze(globalObject, rootCertificates));
}

} // namespace Bun
