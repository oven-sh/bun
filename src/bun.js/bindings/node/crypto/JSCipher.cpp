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
}

template<typename Visitor>
void JSCipher::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCipher* thisObject = jsCast<JSCipher*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
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

JSValue rsaFunction(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, KeyType keyType, CipherOperation operation, int32_t defaultPadding)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue optionsValue = callFrame->argument(0);
    JSValue bufferValue = callFrame->argument(1);

    KeyObject keyObject;
    switch (keyType) {
    case KeyType::Public: {
        ncrypto::MarkPopErrorOnReturn popErrorScope;
        auto prepareResult = KeyObject::preparePublicOrPrivateKey(globalObject, scope, optionsValue);
        RETURN_IF_EXCEPTION(scope, {});
        if (prepareResult.keyData) {
            RefPtr<KeyObjectData> data = *prepareResult.keyData;
            keyObject = KeyObject::create(CryptoKeyType::Public, WTFMove(data));
        } else {
            keyObject = KeyObject::getPublicOrPrivateKey(
                globalObject,
                scope,
                prepareResult.keyDataView,
                CryptoKeyType::Public,
                prepareResult.formatType,
                prepareResult.encodingType,
                prepareResult.cipher,
                WTFMove(prepareResult.passphrase));
            RETURN_IF_EXCEPTION(scope, {});
        }
        break;
    }
    case KeyType::Private: {
        ncrypto::MarkPopErrorOnReturn popErrorScope;
        auto prepareResult = KeyObject::preparePrivateKey(globalObject, scope, optionsValue);
        RETURN_IF_EXCEPTION(scope, {});
        if (prepareResult.keyData) {
            RefPtr<KeyObjectData> data = *prepareResult.keyData;
            keyObject = KeyObject::create(CryptoKeyType::Private, WTFMove(data));
        } else {
            keyObject = KeyObject::getPublicOrPrivateKey(
                globalObject,
                scope,
                prepareResult.keyDataView,
                CryptoKeyType::Private,
                prepareResult.formatType,
                prepareResult.encodingType,
                prepareResult.cipher,
                WTFMove(prepareResult.passphrase));
            RETURN_IF_EXCEPTION(scope, {});
        }
        break;
    }
    }

    auto& pkey = keyObject.asymmetricKey();

    ncrypto::Digest digest;
    int32_t padding = defaultPadding;
    GCOwnedDataScope<std::span<const uint8_t>> oaepLabel = { nullptr, {} };
    JSValue encodingValue = jsUndefined();
    if (JSObject* options = optionsValue.getObject()) {
        JSValue paddingValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "padding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!paddingValue.isUndefined()) {
            padding = paddingValue.toInt32(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSValue oaepHashValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "oaepHash"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!oaepHashValue.isUndefined()) {
            V::validateString(scope, lexicalGlobalObject, oaepHashValue, "options.oaepHash"_s);
            RETURN_IF_EXCEPTION(scope, {});
            JSString* oaepHashString = oaepHashValue.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            GCOwnedDataScope<WTF::StringView> oaepHashView = oaepHashString->view(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            digest = ncrypto::Digest::FromName(oaepHashView);
            if (!digest) {
                ERR::OSSL_EVP_INVALID_DIGEST(scope, lexicalGlobalObject);
                return {};
            }
        }

        encodingValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});

        JSValue oaepLabelValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "oaepLabel"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!oaepLabelValue.isUndefined()) {
            oaepLabel = getArrayBufferOrView2(lexicalGlobalObject, scope, oaepLabelValue, "options.oaepLabel"_s, encodingValue);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    auto buffer = getArrayBufferOrView2(lexicalGlobalObject, scope, bufferValue, "buffer"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (operation == CipherOperation::decrypt && keyType == KeyType::Private && padding == RSA_PKCS1_PADDING) {
        ncrypto::EVPKeyCtxPointer ctx = pkey.newCtx();

        if (!ctx.initForDecrypt()) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error());
            return {};
        }

        throwError(lexicalGlobalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "RSA_PKCS1_PADDING is no longer supported for private decryption"_s);
    }

    ncrypto::Buffer<const void> labelBuf = {};
    if (oaepLabel.owner) {
        labelBuf = {
            .data = oaepLabel->data(),
            .len = oaepLabel->size(),
        };
    }

    ncrypto::Cipher::CipherParams cipherParams {
        .padding = padding,
        .digest = digest,
        .label = labelBuf,
    };

    ncrypto::Buffer<const void> bufferBuf {
        .data = buffer->data(),
        .len = buffer->size(),
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

    return JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(outBuf), 0, result.size());
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
