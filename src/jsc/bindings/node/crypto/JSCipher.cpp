#include "JSCipher.h"
#include "JSCipherPrototype.h"
#include "JSCipherConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "CryptoUtil.h"
#include "openssl/rsa.h"
#include "NodeValidator.h"
#include "KeyObject.h"

namespace Bun {

const JSC::ClassInfo JSCipher::s_info = { "Cipher"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCipher) };

void JSCipher::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    if (m_ctx) {
        m_sizeForGC = sizeof(EVP_CIPHER_CTX);
        vm.heap.reportExtraMemoryAllocated(this, m_sizeForGC);
    }
}

template<typename Visitor>
void JSCipher::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCipher* thisObject = uncheckedDowncast<JSCipher>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSCipher);

void setupCipherClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSCipherPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSCipherPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSCipherConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSCipherConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSCipher::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

enum class KeyType {
    Public,
    Private,
};

enum class CipherOperation {
    encrypt,
    decrypt,
    sign,
    recover,
};

// Looks up the digest that a string option names.
static void getDigestOption(JSGlobalObject* globalObject, ThrowScope& scope, JSValue name, ncrypto::Digest& digest)
{
    GCOwnedDataScope<WTF::StringView> view = asString(name)->view(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    digest = ncrypto::Digest::FromName(view);
    if (!digest)
        ERR::OSSL_EVP_INVALID_DIGEST(scope, globalObject);
}

JSValue rsaFunction(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, KeyType keyType, CipherOperation operation, int32_t defaultPadding)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    JSValue optionsValue = callFrame->argument(0);
    JSValue bufferValue = callFrame->argument(1);

    // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/crypto/cipher.js#L67-L87
    auto preparedKey = KeyObject::prepareAsymmetricKey(globalObject, scope, optionsValue,
        keyType == KeyType::Private ? KeyObject::PrepareAsymmetricKeyMode::ConsumePrivate : KeyObject::PrepareAsymmetricKeyMode::ConsumePublic);
    RETURN_IF_EXCEPTION(scope, {});

    int32_t padding = defaultPadding;
    JSValue oaepHashValue = jsUndefined();
    JSValue mgf1HashValue = jsUndefined();
    JSValue encodingValue = jsUndefined();
    BufferArgument oaepLabel;
    if (JSObject* options = optionsValue.getObject()) {
        JSValue paddingValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "padding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        // Node: `key.padding || defaultPadding`
        if (paddingValue.toBoolean(lexicalGlobalObject)) {
            padding = paddingValue.toInt32(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }

        oaepHashValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "oaepHash"_s));
        RETURN_IF_EXCEPTION(scope, {});
        mgf1HashValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "mgf1Hash"_s));
        RETURN_IF_EXCEPTION(scope, {});
        encodingValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue oaepLabelValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "oaepLabel"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!oaepHashValue.isUndefined()) {
            V::validateString(scope, lexicalGlobalObject, oaepHashValue, "key.oaepHash"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (!mgf1HashValue.isUndefined()) {
            V::validateString(scope, lexicalGlobalObject, mgf1HashValue, "key.mgf1Hash"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (!oaepLabelValue.isUndefined()) {
            oaepLabel = getArrayBufferOrView(lexicalGlobalObject, scope, oaepLabelValue, "key.oaepLabel"_s, encodingValue);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    auto buffer = getArrayBufferOrView(lexicalGlobalObject, scope, bufferValue, "buffer"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Node looks the digests up after it has read the key. For the private functions it reads a public key
    // too, which the import below refuses, so a digest that is not known has to be reported before it.
    ncrypto::Digest digest;
    ncrypto::Digest mgf1Digest;
    if (!oaepHashValue.isUndefined()) {
        getDigestOption(lexicalGlobalObject, scope, oaepHashValue, digest);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!mgf1HashValue.isUndefined()) {
        getDigestOption(lexicalGlobalObject, scope, mgf1HashValue, mgf1Digest);
        RETURN_IF_EXCEPTION(scope, {});
    }

    KeyObject keyObject;
    {
        ncrypto::MarkPopErrorOnReturn popErrorScope;
        keyObject = KeyObject::importPreparedKey(globalObject, scope, WTF::move(preparedKey));
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto& pkey = keyObject.asymmetricKey();

    if (operation == CipherOperation::decrypt && keyType == KeyType::Private && padding == RSA_PKCS1_PADDING) {
        ncrypto::EVPKeyCtxPointer ctx = pkey.newCtx();

        if (!ctx.initForDecrypt()) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error());
            return {};
        }

        throwError(lexicalGlobalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "RSA_PKCS1_PADDING is no longer supported for private decryption"_s);
        return {};
    }

    // Read after the import, which runs the getters of a JWK.
    std::span<const uint8_t> input = buffer.span();
    std::span<const uint8_t> label = oaepLabel.span();
    if (label.size() > INT32_MAX) [[unlikely]] {
        throwError(lexicalGlobalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "oaepLabel is too big"_s);
        return {};
    }

    // Under another padding, OpenSSL's encryption and decryption ignore the OAEP options. BoringSSL refuses them.
    if (padding != RSA_PKCS1_OAEP_PADDING && (operation == CipherOperation::encrypt || operation == CipherOperation::decrypt)) {
        digest = nullptr;
        mgf1Digest = nullptr;
        label = {};
    }

    ncrypto::Cipher::CipherParams cipherParams {
        .padding = padding,
        .digest = digest,
        .mgf1_digest = mgf1Digest,
        .label = { .data = label.data(), .len = label.size() },
    };

    ncrypto::Buffer<const void> bufferBuf {
        .data = input.data(),
        .len = input.size(),
    };

    ncrypto::DataPointer result;
    switch (operation) {
    case CipherOperation::encrypt:
        result = ncrypto::Cipher::encrypt(pkey, cipherParams, bufferBuf);
        break;
    case CipherOperation::decrypt:
        result = ncrypto::Cipher::decrypt(pkey, cipherParams, bufferBuf);
        break;
    case CipherOperation::sign:
        result = ncrypto::Cipher::sign(pkey, cipherParams, bufferBuf);
        break;
    case CipherOperation::recover:
        result = ncrypto::Cipher::recover(pkey, cipherParams, bufferBuf);
        break;
    }

    if (!result) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_get_error());
        return {};
    }

    RefPtr<ArrayBuffer> outBuf = JSC::ArrayBuffer::tryCreate(result.span());
    if (!outBuf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(outBuf), 0, result.size()));
}

JSC_DEFINE_HOST_FUNCTION(jsPublicEncrypt, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(rsaFunction(globalObject, callFrame, KeyType::Public, CipherOperation::encrypt, RSA_PKCS1_OAEP_PADDING));
}
JSC_DEFINE_HOST_FUNCTION(jsPublicDecrypt, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(rsaFunction(globalObject, callFrame, KeyType::Public, CipherOperation::recover, RSA_PKCS1_PADDING));
}
JSC_DEFINE_HOST_FUNCTION(jsPrivateEncrypt, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(rsaFunction(globalObject, callFrame, KeyType::Private, CipherOperation::sign, RSA_PKCS1_PADDING));
}
JSC_DEFINE_HOST_FUNCTION(jsPrivateDecrypt, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(rsaFunction(globalObject, callFrame, KeyType::Private, CipherOperation::decrypt, RSA_PKCS1_OAEP_PADDING));
}

} // namespace Bun
