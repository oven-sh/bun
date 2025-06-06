#include "config.h"
#include "NodeTLS.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"

#include "ErrorCode.h"
#include "ErrorCode+List.h"
#include "JSDOMExceptionHandling.h"
#include "ZigGlobalObject.h"

#include "libusockets.h"
#include "wtf/Scope.h"

namespace Bun {

using namespace JSC;

BUN_DECLARE_HOST_FUNCTION(Bun__canonicalizeIP);

JSC::JSValue createNodeTLSBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSFinalObject* obj = constructEmptyObject(globalObject);

    us_cert_string_t* out;

    int size = us_raw_root_certs(&out);
    if (size < 0) [[unlikely]] {
        return jsUndefined();
    }

    JSArray* rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);

    for (int i = 0; i < size; i++) {
        us_cert_string_t raw = out[i];
        String str = String::fromUTF8(std::span { raw.str, raw.len });
        rootCertificates->putDirectIndex(globalObject, i, JSC::jsString(vm, str));
    }

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "rootCertificates"_s)),
        JSC::objectConstructorFreeze(globalObject, rootCertificates),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "canonicalizeIP"_s)),
        JSC::JSFunction::create(vm, globalObject, 1, "canonicalizeIP"_s, Bun__canonicalizeIP, ImplementationVisibility::Public, NoIntrinsic),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "SecureContext"_s)),
        defaultGlobalObject(globalObject)->NodeTLSSecureContext(),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "SSL_OP_CIPHER_SERVER_PREFERENCE"_s)),
        JSC::jsNumber(SSL_OP_CIPHER_SERVER_PREFERENCE),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "TLS1_3_VERSION"_s)),
        JSC::jsNumber(TLS1_3_VERSION),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "TLS1_2_VERSION"_s)),
        JSC::jsNumber(TLS1_2_VERSION),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "TLS1_1_VERSION"_s)),
        JSC::jsNumber(TLS1_1_VERSION),
        0);

    obj->putDirect(vm,
        JSC::PropertyName(JSC::Identifier::fromString(vm, "TLS1_VERSION"_s)),
        JSC::jsNumber(TLS1_VERSION),
        0);

    return obj;
}

void configureNodeTLS(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    globalObject->m_NodeTLSSecureContextClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeTLSSecureContext::createPrototype(init.vm, init.global);
            auto* structure = NodeTLSSecureContext::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeTLSSecureContextConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeTLSSecureContextConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });
}

static EncodedJSValue throwCryptoError(JSGlobalObject* globalObject, ThrowScope& scope, uint32_t err, const char* message)
{
    char message_buffer[128] {};

    if (err != 0 || message == nullptr) {
        ERR_error_string_n(err, message_buffer, sizeof(message_buffer));
        message = message_buffer;
    }

    RELEASE_ASSERT(*message != '\0');

    throwException(globalObject, scope, jsString(globalObject->vm(), String::fromUTF8(message)));
    return {};
}

NodeTLSSecureContext* NodeTLSSecureContext::create(VM& vm, JSGlobalObject* globalObject, ArgList args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    NodeTLSSecureContext* ptr = new (NotNull, allocateCell<NodeTLSSecureContext>(vm)) NodeTLSSecureContext(vm, zigGlobalObject->NodeTLSSecureContextStructure());
    ptr->finishCreation(vm);
    return ptr;
}

NodeTLSSecureContext::NodeTLSSecureContext(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

NodeTLSSecureContext::~NodeTLSSecureContext() = default;

void NodeTLSSecureContext::setCACert(const ncrypto::BIOPointer& bio)
{
    if (!bio) {
        return;
    }

    while (ncrypto::X509Pointer x509 = ncrypto::X509Pointer(PEM_read_bio_X509_AUX(bio.get(), nullptr, ncrypto::NoPasswordCallback, nullptr))) {
        RELEASE_ASSERT(X509_STORE_add_cert(getCertStore(), x509.get()) == 1);
        RELEASE_ASSERT(SSL_CTX_add_client_CA(context(), x509.get()) == 1);
    }
}

void NodeTLSSecureContext::setX509StoreFlag(unsigned long flags)
{
    RELEASE_ASSERT(X509_STORE_set_flags(getCertStore(), flags) == 1);
}

X509_STORE* NodeTLSSecureContext::getCertStore() const
{
    if (m_certStore == nullptr) {
        // TODO(@heimskr): complete implementation.
        m_certStore = { X509_STORE_new(), X509_STORE_free };
        SSL_CTX_set_cert_store(m_context.get(), m_certStore.get());
    }
    return m_certStore.get();
}

int NodeTLSSecureContext::ticketCompatibilityCallback(SSL* ssl, unsigned char* name, unsigned char* iv, EVP_CIPHER_CTX* ectx, HMAC_CTX* hctx, int enc)
{
    auto* secureContext = static_cast<NodeTLSSecureContext*>(SSL_CTX_get_app_data(SSL_get_SSL_CTX(ssl)));

    if (enc) {
        memcpy(name, secureContext->m_ticketKeyName, sizeof(secureContext->m_ticketKeyName));
        if (!ncrypto::CSPRNG(iv, 16) || EVP_EncryptInit_ex(ectx, EVP_aes_128_cbc(), nullptr, secureContext->m_ticketKeyAES, iv) <= 0 || HMAC_Init_ex(hctx, secureContext->m_ticketKeyHMAC, sizeof(secureContext->m_ticketKeyHMAC), EVP_sha256(), nullptr) <= 0) {
            return -1;
        }

        return 1;
    }

    if (memcmp(name, secureContext->m_ticketKeyName, sizeof(secureContext->m_ticketKeyName)) != 0) {
        // The ticket key name does not match. Discard the ticket.
        return 0;
    }

    if (EVP_DecryptInit_ex(ectx, EVP_aes_128_cbc(), nullptr, secureContext->m_ticketKeyAES, iv) <= 0 || HMAC_Init_ex(hctx, secureContext->m_ticketKeyHMAC, sizeof(secureContext->m_ticketKeyHMAC), EVP_sha256(), nullptr) <= 0) {
        return -1;
    }

    return 1;
}

JSC_DEFINE_HOST_FUNCTION(secureContextInit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* thisObject = jsCast<NodeTLSSecureContext*>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);

    ArgList args(callFrame);
    JSValue secureProtocolValue = args.at(0);
    JSValue minVersionValue = args.at(1);
    JSValue maxVersionValue = args.at(2);

    int minVersion = minVersionValue.toInt32(globalObject);
    int maxVersion = maxVersionValue.toInt32(globalObject);
    const SSL_METHOD* method = TLS_method();

    if (secureProtocolValue.isString()) {
        String secureProtocol = secureProtocolValue.toWTFString(globalObject);

        if (secureProtocol == "SSLv2_method" || secureProtocol == "SSLv2_server_method" || secureProtocol == "SSLv2_client_method") {
            throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_TLS_INVALID_PROTOCOL_METHOD, "SSLv2 methods disabled"_s));
            return {};
        }

        if (secureProtocol == "SSLv3_method" || secureProtocol == "SSLv3_server_method" || secureProtocol == "SSLv3_client_method") {
            throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_TLS_INVALID_PROTOCOL_METHOD, "SSLv3 methods disabled"_s));
            return {};
        }

        constexpr int maxSupportedVersion = TLS1_3_VERSION;

        if (secureProtocol == "SSLv23_method") {
            maxVersion = TLS1_2_VERSION;
        } else if (secureProtocol == "SSLv23_server_method") {
            maxVersion = TLS1_2_VERSION;
            method = TLS_server_method();
        } else if (secureProtocol == "SSLv23_client_method") {
            maxVersion = TLS1_2_VERSION;
            method = TLS_client_method();
        } else if (secureProtocol == "TLS_method") {
            minVersion = 0;
            maxVersion = maxSupportedVersion;
        } else if (secureProtocol == "TLS_server_method") {
            minVersion = 0;
            maxVersion = maxSupportedVersion;
            method = TLS_server_method();
        } else if (secureProtocol == "TLS_client_method") {
            minVersion = 0;
            maxVersion = maxSupportedVersion;
            method = TLS_client_method();
        } else if (secureProtocol == "TLSv1_method") {
            minVersion = TLS1_VERSION;
            maxVersion = TLS1_VERSION;
        } else if (secureProtocol == "TLSv1_server_method") {
            minVersion = TLS1_VERSION;
            maxVersion = TLS1_VERSION;
            method = TLS_server_method();
        } else if (secureProtocol == "TLSv1_client_method") {
            minVersion = TLS1_VERSION;
            maxVersion = TLS1_VERSION;
            method = TLS_client_method();
        } else if (secureProtocol == "TLSv1_1_method") {
            minVersion = TLS1_1_VERSION;
            maxVersion = TLS1_1_VERSION;
        } else if (secureProtocol == "TLSv1_1_server_method") {
            minVersion = TLS1_1_VERSION;
            maxVersion = TLS1_1_VERSION;
            method = TLS_server_method();
        } else if (secureProtocol == "TLSv1_1_client_method") {
            minVersion = TLS1_1_VERSION;
            maxVersion = TLS1_1_VERSION;
            method = TLS_client_method();
        } else if (secureProtocol == "TLSv1_2_method") {
            minVersion = TLS1_2_VERSION;
            maxVersion = TLS1_2_VERSION;
        } else if (secureProtocol == "TLSv1_2_server_method") {
            minVersion = TLS1_2_VERSION;
            maxVersion = TLS1_2_VERSION;
            method = TLS_server_method();
        } else if (secureProtocol == "TLSv1_2_client_method") {
            minVersion = TLS1_2_VERSION;
            maxVersion = TLS1_2_VERSION;
            method = TLS_client_method();
        } else {
            throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_TLS_INVALID_PROTOCOL_METHOD, makeString("Unknown method: "_s, secureProtocol)));
            return {};
        }
    }

    thisObject->context(SSL_CTX_new(method));
    SSL_CTX* context = thisObject->context();

    if (!context) {
        return throwCryptoError(globalObject, scope, ERR_get_error(), "SSL_CTX_new");
    }

    SSL_CTX_set_app_data(context, thisObject);
    SSL_CTX_set_options(context, SSL_OP_NO_SSLv2);
    SSL_CTX_set_options(context, SSL_OP_NO_SSLv3);

#if OPENSSL_VERSION_MAJOR >= 3
    // TODO(@heimskr): OPENSSL_VERSION_MAJOR doesn't appear to be defined anywhere.
    SSL_CTX_set_options(context, SSL_OP_ALLOW_CLIENT_RENEGOTIATION);
#endif

    SSL_CTX_clear_mode(context, SSL_MODE_NO_AUTO_CHAIN);
    SSL_CTX_set_session_cache_mode(context, SSL_SESS_CACHE_CLIENT | SSL_SESS_CACHE_SERVER | SSL_SESS_CACHE_NO_INTERNAL | SSL_SESS_CACHE_NO_AUTO_CLEAR);

    RELEASE_ASSERT(SSL_CTX_set_min_proto_version(context, minVersion));
    RELEASE_ASSERT(SSL_CTX_set_max_proto_version(context, maxVersion));

    if (!ncrypto::CSPRNG(thisObject->m_ticketKeyName, sizeof(thisObject->m_ticketKeyName)) || !ncrypto::CSPRNG(thisObject->m_ticketKeyHMAC, sizeof(thisObject->m_ticketKeyHMAC)) || !ncrypto::CSPRNG(thisObject->m_ticketKeyAES, sizeof(thisObject->m_ticketKeyAES))) {
        throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Error generating ticket keys"_s));
        return {};
    }

    SSL_CTX_set_tlsext_ticket_key_cb(context, NodeTLSSecureContext::ticketCompatibilityCallback);

    return JSC::encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(secureContextSetCiphers, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* thisObject = jsCast<NodeTLSSecureContext*>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);

    JSValue ciphersValue = args.at(0);

    if (!ciphersValue.isString()) {
        return throwArgumentTypeError(*globalObject, scope, 0, "ciphers"_s, "SecureContext"_s, "setCiphers"_s, "string"_s);
    }

    CString ciphers = ciphersValue.toWTFString(globalObject).utf8();

    if (!SSL_CTX_set_cipher_list(thisObject->context(), ciphers.data())) {
        unsigned long err = ERR_get_error();

        if (ciphers.length() == 0 && ERR_GET_REASON(err) == SSL_R_NO_CIPHER_MATCH) {
            return JSC::encodedJSUndefined();
        }

        return throwCryptoError(globalObject, scope, err, "Failed to set ciphers");
    }

    return JSC::encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(secureContextAddCACert, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* thisObject = jsCast<NodeTLSSecureContext*>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);

    JSValue certValue = args.at(0);

    auto* arrayBufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(certValue);

    CString cert;

    if (certValue.isString()) {
        cert = certValue.toWTFString(globalObject).utf8();
    } else if (arrayBufferView != nullptr && !arrayBufferView->isDetached()) {
        cert = arrayBufferView->span();
    } else {
        return throwArgumentTypeError(*globalObject, scope, 0, "cert"_s, "SecureContext"_s, "addCACert"_s, "string or ArrayBuffer"_s);
    }

    if (cert.length() > INT_MAX) {
        return JSC::encodedJSUndefined();
    }

    ncrypto::BIOPointer bio = ncrypto::BIOPointer::NewSecMem();

    if (!bio) {
        return JSC::encodedJSUndefined();
    }

    int written = ncrypto::BIOPointer::Write(&bio, cert.span());
    if (written < 0 || static_cast<size_t>(written) != cert.length()) {
        return JSC::encodedJSUndefined();
    }

    thisObject->setCACert(bio);
    return JSC::encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(secureContextSetECDHCurve, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* thisObject = jsCast<NodeTLSSecureContext*>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);

    JSValue curveValue = args.at(0);

    if (!curveValue.isString()) {
        return throwArgumentTypeError(*globalObject, scope, 0, "curve"_s, "SecureContext"_s, "setECDHCurve"_s, "string"_s);
    }

    String curve = curveValue.toWTFString(globalObject);

    if (curve != "auto" && !SSL_CTX_set1_curves_list(thisObject->context(), curve.utf8().data())) {
        return throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to set ECDH curve");
    }

    return JSC::encodedJSUndefined();
}

static const HashTableValue NodeTLSSecureContextPrototypeTableValues[] = {
    { "init"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, secureContextInit, 3 } },
    { "setCiphers"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, secureContextSetCiphers, 1 } },
    { "addCACert"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, secureContextAddCACert, 1 } },
    { "setECDHCurve"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, secureContextSetECDHCurve, 1 } },
};

static EncodedJSValue constructSecureContext(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = {})
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);

    NodeTLSSecureContext* secureContext = NodeTLSSecureContext::create(vm, globalObject, args);

    return JSValue::encode(secureContext);
}

JSC_DEFINE_HOST_FUNCTION(secureContextConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructSecureContext(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(secureContextConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructSecureContext(globalObject, callFrame, callFrame->newTarget());
}

NodeTLSSecureContextConstructor* NodeTLSSecureContextConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    NodeTLSSecureContextConstructor* ptr = new (NotNull, allocateCell<NodeTLSSecureContextConstructor>(vm)) NodeTLSSecureContextConstructor(vm, structure);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

NodeTLSSecureContextConstructor::NodeTLSSecureContextConstructor(VM& vm, Structure* structure)
    : NodeTLSSecureContextConstructor::Base(vm, structure, secureContextConstructorCall, secureContextConstructorConstruct)
{
}

void NodeTLSSecureContextConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "SecureContext"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

void NodeTLSSecureContextPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    reifyStaticProperties(vm, info(), NodeTLSSecureContextPrototypeTableValues, *this);
    this->structure()->setMayBePrototype(true);
}

template<typename Visitor>
void NodeTLSSecureContext::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = jsCast<NodeTLSSecureContext*>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);
}

DEFINE_VISIT_CHILDREN(NodeTLSSecureContext);

const ClassInfo NodeTLSSecureContext::s_info = { "NodeTLSSecureContext"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeTLSSecureContext) };
const ClassInfo NodeTLSSecureContextPrototype::s_info = { "NodeTLSSecureContext"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeTLSSecureContextPrototype) };
const ClassInfo NodeTLSSecureContextConstructor::s_info = { "SecureContext"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeTLSSecureContextConstructor) };

} // namespace Bun
