#include "root.h"

#include <limits>

#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "libusockets.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "node/crypto/CryptoUtil.h"
#include "ncrypto.h"
#include "openssl/base.h"
#include "openssl/bio.h"
#include "openssl/err.h"
#include "openssl/pem.h"
#include "openssl/pool.h"
#include "openssl/x509.h"
#include "../../packages/bun-usockets/src/crypto/root_certs_header.h"
#include "wtf/SIMDUTF.h"

namespace Bun {

using namespace JSC;

// tls.rootCertificates has always been 72-column base64 with no trailing newline; everything that went through
// PEM_write_bio_X509 (getCACertificates('system' | 'extra')) is 64-column with one.
enum class PEMStyle { RootCertificates,
    OpenSSL };
static WTF::String pemFromDER(std::span<const uint8_t> der, PEMStyle style)
{
    static constexpr auto header = "-----BEGIN CERTIFICATE-----\n"_s;
    static constexpr auto footer = "-----END CERTIFICATE-----\n"_s;
    size_t lineLength = style == PEMStyle::RootCertificates ? 72 : 64;
    size_t footerLength = style == PEMStyle::RootCertificates ? footer.length() - 1 : footer.length();
    size_t bodyLength = simdutf::base64_length_from_binary_with_lines(der.size(), simdutf::base64_default, lineLength);
    std::span<Latin1Character> buffer;
    auto result = WTF::String::createUninitialized(header.length() + bodyLength + 1 + footerLength, buffer);
    memcpySpan(buffer, header.span8());
    size_t offset = header.length();
    offset += simdutf::binary_to_base64_with_lines(reinterpret_cast<const char*>(der.data()), der.size(), reinterpret_cast<char*>(buffer.data() + offset), lineLength, simdutf::base64_default);
    buffer[offset++] = '\n';
    memcpySpan(buffer.subspan(offset), footer.span8().first(footerLength));
    ASSERT(offset + footerLength == buffer.size());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(getBundledRootCertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    const uint8_t* const* certs;
    const size_t* lens;
    size_t size = us_bundled_root_certs_der(&certs, &lens);
    auto rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);
    for (size_t i = 0; i < size; i++) {
        rootCertificates->putDirectIndex(globalObject, i, JSC::jsString(vm, pemFromDER({ certs[i], lens[i] }, PEMStyle::RootCertificates)));
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::objectConstructorFreeze(globalObject, rootCertificates)));
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

    const us_system_certs_t& system = us_get_root_system_certs();

    JSC::MarkedArgumentBuffer args;
    for (size_t i = 0, n = system.lazy ? X509_LAZY_CERT_SET_num(system.lazy) : 0; i < n; i++) {
        const CRYPTO_BUFFER* der = X509_LAZY_CERT_SET_get0_der(system.lazy, i);
        args.append(JSC::jsString(vm, pemFromDER({ CRYPTO_BUFFER_data(der), CRYPTO_BUFFER_len(der) }, PEMStyle::OpenSSL)));
    }
    STACK_OF(X509)* root_system_cert_instances = system.parsed;
    auto size = sk_X509_num(root_system_cert_instances);
    if (size < 0) size = 0; // no parsed certificates on this platform

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

// One input slot for the PEM parse pass. String inputs hold their UTF-8 bytes
// in a CString (the WTF string's backing is not guaranteed UTF-8).
// ArrayBufferView inputs hold the view pointer so pass 2 can read
// vector()/byteLength() without copying; the MarkedArgumentBuffer below roots
// the view against GC, and pass 2 re-checks isDetached() before reading
// because forEachInIterable drives the iterator protocol and a tampered
// %ArrayIteratorPrototype%.next can detach an earlier element between pass-1
// callbacks.
using CACertInput = std::variant<WTF::CString, JSC::JSArrayBufferView*>;

JSC_DEFINE_HOST_FUNCTION(parseCACertificates, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    JSValue certs = callFrame->argument(0);
    if (!certs.isObject()) {
        return throwVMTypeError(globalObject, scope, "expected an array of certificates"_s);
    }

    // Pass 1: collect inputs. All JS type checks / coercions happen here with
    // no BoringSSL resources live, so RETURN_IF_EXCEPTION cannot leak.
    JSC::MarkedArgumentBuffer keepAlive;
    WTF::Vector<CACertInput, 8> inputs;

    forEachInIterable(globalObject, certs, [&](VM&, JSGlobalObject* g, JSValue element) {
        auto innerScope = DECLARE_THROW_SCOPE(vm);
        keepAlive.append(element);
        if (keepAlive.hasOverflowed()) {
            throwOutOfMemoryError(g, innerScope);
            return;
        }
        if (element.isString()) {
            auto string = element.toWTFString(g);
            RETURN_IF_EXCEPTION(innerScope, );
            inputs.append(string.utf8());
            return;
        }
        if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(element)) {
            if (view->isDetached()) {
                throwVMTypeError(g, innerScope, "certificate buffer is detached"_s);
                return;
            }
            inputs.append(view);
            return;
        }
        throwVMTypeError(g, innerScope, "expected a string or ArrayBufferView"_s);
    });
    RETURN_IF_EXCEPTION(scope, {});

    // Pass 2: PEM_read_bio_X509 over each span. ncrypto's RAII pointers own
    // the BIO/X509 so no manual cleanup is interleaved with error checks; any
    // BoringSSL error is recorded and thrown below, after all RAII scopes exit.
    // No user JS runs in this pass (nothing here dispatches to JS), so a view's
    // backing store cannot be detached out from under the span read below.
    WTF::Vector<WTF::String, 16> pems;
    WTF::HashSet<WTF::String> seen;
    unsigned long parseError = 0;
    bool oom = false;

    for (auto& in : inputs) {
        std::span<const uint8_t> bytes;
        if (auto* utf8 = std::get_if<WTF::CString>(&in)) {
            bytes = { reinterpret_cast<const uint8_t*>(utf8->data()), utf8->length() };
        } else {
            auto* view = std::get<JSC::JSArrayBufferView*>(in);
            if (view->isDetached()) {
                return throwVMTypeError(globalObject, scope, "certificate buffer is detached"_s);
            }
            bytes = { reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength() };
        }
        if (bytes.size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
            return throwVMTypeError(globalObject, scope, "certificate is too large"_s);
        }
        ERR_clear_error();
        auto bio = ncrypto::BIOPointer::New(bytes.data(), bytes.size());
        if (!bio) {
            oom = true;
            break;
        }
        while (auto x509 = ncrypto::X509Pointer(PEM_read_bio_X509(bio.get(), nullptr, noPasswordCallback, nullptr))) {
            auto out = ncrypto::BIOPointer::NewMem();
            if (!out || PEM_write_bio_X509(out.get(), x509.get()) != 1) {
                oom = !out;
                parseError = out ? ERR_peek_last_error() : 0;
                break;
            }
            BUF_MEM* mem = out;
            auto pem = WTF::String::fromUTF8(std::span { mem->data, mem->length });
            if (seen.add(pem).isNewEntry)
                pems.append(WTF::move(pem));
        }
        if (oom || parseError) break;
        // PEM_R_NO_START_LINE is the normal end-of-stream marker.
        unsigned long err = ERR_peek_last_error();
        if (err != 0 && !(ERR_GET_LIB(err) == ERR_LIB_PEM && ERR_GET_REASON(err) == PEM_R_NO_START_LINE)) {
            parseError = err;
            break;
        }
        ERR_clear_error();
    }

    if (oom) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    if (parseError) {
        // Reuse the shared ERR_OSSL_<LIB>_<REASON> decoration path
        // (library/function/reason/code + opensslErrorStack), same as node:crypto.
        throwCryptoError(globalObject, scope, parseError);
        return {};
    }

    JSC::MarkedArgumentBuffer results;
    for (auto& pem : pems) {
        results.append(JSC::jsString(vm, pem));
        if (results.hasOverflowed()) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
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
