#include "node_crypto_binding.h"
#include "ErrorCode.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "ZigGlobalObject.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSSubtleCrypto.h"
#include "webcrypto/CryptoKeyOKP.h"
#include "webcrypto/CryptoKeyEC.h"
#include "webcrypto/CryptoKeyRSA.h"
#include "webcrypto/CryptoKeyAES.h"
#include "webcrypto/CryptoKeyHMAC.h"
#include "webcrypto/CryptoKeyRaw.h"
#include "webcrypto/CryptoKeyUsage.h"
#include "webcrypto/JsonWebKey.h"
#include "webcrypto/JSJsonWebKey.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "headers-handwritten.h"
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/x509.h>
#include <openssl/pem.h>
#include <openssl/curve25519.h>
#include "JSBuffer.h"
#include "CryptoAlgorithmHMAC.h"
#include "CryptoAlgorithmEd25519.h"
#include "CryptoAlgorithmRSA_OAEP.h"
#include "CryptoAlgorithmRSA_PSS.h"
#include "CryptoAlgorithmRSASSA_PKCS1_v1_5.h"
#include "CryptoAlgorithmECDSA.h"
#include "CryptoAlgorithmEcdsaParams.h"
#include "CryptoAlgorithmRsaOaepParams.h"
#include "CryptoAlgorithmRsaPssParams.h"
#include "CryptoAlgorithmRegistry.h"
#include "wtf/ForbidHeapAllocation.h"
#include "wtf/Noncopyable.h"
#include "ncrypto.h"
#include "AsymmetricKeyValue.h"
#include "NodeValidator.h"
#include "JSSign.h"
#include "JSVerify.h"
#include "JSHmac.h"
#include "JSHash.h"
#include "CryptoPrimes.h"
#include "JSCipher.h"
#include "CryptoHkdf.h"
#include "JSKeyObject.h"
#include "JSSecretKeyObject.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"
#include "CryptoUtil.h"
#include "CryptoKeygen.h"
#include "CryptoGenKeyPair.h"
#include "CryptoKeys.h"
#include "CryptoDhJob.h"
#include "CryptoSignJob.h"

using namespace JSC;

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsGetCurves, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    const size_t numCurves = EC_get_builtin_curves(nullptr, 0);
    Vector<EC_builtin_curve> curves(numCurves);
    EC_get_builtin_curves(curves.begin(), numCurves);

    JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, numCurves);
    RETURN_IF_EXCEPTION(scope, {});

    for (size_t i = 0; i < numCurves; i++) {
        const char* curveName = OBJ_nid2sn(curves[i].nid);
        auto curveWTFStr = WTF::String::fromUTF8(curveName);
        JSString* curveStr = JSC::jsString(vm, curveWTFStr);
        result->putDirectIndex(lexicalGlobalObject, i, curveStr);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGetCiphers, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ncrypto::MarkPopErrorOnReturn mark_pop_error_on_return;

    // Create an array to store cipher names
    JSC::JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    struct CipherPushContext {
        JSC::JSGlobalObject* globalObject;
        JSC::JSArray* array;
        int index;
        JSC::VM& vm;
        bool hasException;
    };

    CipherPushContext ctx = {
        lexicalGlobalObject,
        result,
        0,
        vm,
        false
    };

    auto callback = [](const EVP_CIPHER* cipher, const char* name, const char* /*unused*/, void* arg) {
        auto* ctx = static_cast<CipherPushContext*>(arg);
        if (ctx->hasException)
            return;

        auto cipherStr = JSC::jsString(ctx->vm, String::fromUTF8(name));
        if (!ctx->array->putDirectIndex(ctx->globalObject, ctx->index++, cipherStr))
            ctx->hasException = true;
    };

    EVP_CIPHER_do_all_sorted(callback, &ctx);

    if (ctx.hasException)
        return JSValue::encode({});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsCertVerifySpkac, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = getBuffer(callFrame->argument(0));
    if (!input) {
        return JSValue::encode(jsUndefined());
    }

    auto buffer = input.value();
    if (buffer.size() > std::numeric_limits<int32_t>().max()) {
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "spkac"_s, 0, std::numeric_limits<int32_t>().max(), jsNumber(buffer.size()));
    }

    bool result = ncrypto::VerifySpkac(reinterpret_cast<const char*>(buffer.data()), buffer.size());
    return JSValue::encode(JSC::jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsCertExportPublicKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = getBuffer(callFrame->argument(0));
    if (!input) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto buffer = input.value();
    if (buffer.size() > std::numeric_limits<int32_t>().max()) {
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "spkac"_s, 0, std::numeric_limits<int32_t>().max(), jsNumber(buffer.size()));
    }

    auto bio = ncrypto::ExportPublicKey(reinterpret_cast<const char*>(buffer.data()), buffer.size());
    if (!bio) {
        return JSValue::encode(jsEmptyString(vm));
    }

    char* data = nullptr;
    long len = BIO_get_mem_data(bio.get(), &data);
    if (len <= 0 || data == nullptr) {
        return JSValue::encode(jsEmptyString(vm));
    }

    return JSValue::encode(jsString(vm, String::fromUTF8({ data, static_cast<size_t>(len) })));
}

JSC_DEFINE_HOST_FUNCTION(jsCertExportChallenge, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = getBuffer(callFrame->argument(0));
    if (!input) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto buffer = input.value();
    if (buffer.size() > std::numeric_limits<int32_t>().max()) {
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "spkac"_s, 0, std::numeric_limits<int32_t>().max(), jsNumber(buffer.size()));
    }

    auto cert = ncrypto::ExportChallenge(reinterpret_cast<const char*>(buffer.data()), buffer.size());
    if (!cert.data || cert.len == 0) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto result = JSC::ArrayBuffer::tryCreate({ reinterpret_cast<const uint8_t*>(cert.data), cert.len });
    if (!result) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto* bufferResult = JSC::JSUint8Array::create(lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferSubclassStructure(), WTFMove(result), 0, cert.len);

    return JSValue::encode(bufferResult);
}

// From node.js
// https://github.com/nodejs/node/blob/5d9b63dbd4049f61657e3cff8b7ad1b6fa54ea26/src/crypto/crypto_cipher.cc#L41
JSC_DEFINE_HOST_FUNCTION(jsGetCipherInfo, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue nameOrNid = callFrame->argument(0);
    if (nameOrNid.isNumber()) {
        Bun::V::validateInt32(scope, lexicalGlobalObject, nameOrNid, "nameOrNid"_s, jsUndefined(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!nameOrNid.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "nameOrNid"_s, "string or number"_s, nameOrNid);
    }

    JSValue options = callFrame->argument(1);

    std::optional<int32_t> keyLengthOpt = std::nullopt;
    std::optional<int32_t> ivLengthOpt = std::nullopt;
    if (!options.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, options, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* optionsObj = options.getObject();

        JSValue keyLengthValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "keyLength"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue ivLengthValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "ivLength"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!keyLengthValue.isUndefined()) {
            int32_t length = 0;
            V::validateInt32(scope, lexicalGlobalObject, keyLengthValue, "keyLength"_s, jsUndefined(), jsUndefined(), &length);
            RETURN_IF_EXCEPTION(scope, {});
            keyLengthOpt = length;
        }
        if (!ivLengthValue.isUndefined()) {
            int32_t length = 0;
            V::validateInt32(scope, lexicalGlobalObject, ivLengthValue, "ivLength"_s, jsUndefined(), jsUndefined(), &length);
            RETURN_IF_EXCEPTION(scope, {});
            ivLengthOpt = length;
        }
    }

    const ncrypto::Cipher cipher = [&] {
        if (nameOrNid.isNumber()) {
            return ncrypto::Cipher::FromNid(nameOrNid.asInt32());
        }

        String name = nameOrNid.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, ncrypto::Cipher());

        return ncrypto::Cipher::FromName(name);
    }();
    RETURN_IF_EXCEPTION(scope, {});

    if (!cipher) {
        return JSValue::encode(jsUndefined());
    }

    int32_t keyLength = cipher.getKeyLength();
    int32_t ivLength = cipher.getIvLength();
    int32_t blockSize = cipher.getBlockSize();
    ASCIILiteral modeLabel = cipher.getModeLabel();
    String name = cipher.getName();

    if (keyLengthOpt.has_value() || ivLengthOpt.has_value()) {
        auto ctx = ncrypto::CipherCtxPointer::New();
        if (!ctx.init(cipher, true)) {
            return JSValue::encode(jsUndefined());
        }

        if (keyLengthOpt.has_value()) {
            if (!ctx.setKeyLength(keyLengthOpt.value())) {
                return JSValue::encode(jsUndefined());
            }
            keyLength = keyLengthOpt.value();
        }

        if (ivLengthOpt.has_value()) {
            int32_t length = ivLengthOpt.value();
            if (cipher.isCcmMode()) {
                if (length < 7 || length > 13) {
                    return JSValue::encode(jsUndefined());
                }
            } else if (cipher.isGcmMode()) {
            } else if (cipher.isOcbMode()) {
                if (!ctx.setIvLength(length)) {
                    return JSValue::encode(jsUndefined());
                }
            } else {
                if (length != ivLength) {
                    return JSValue::encode(jsUndefined());
                }
            }
            ivLength = ivLengthOpt.value();
        }
    }

    JSObject* result = JSC::constructEmptyObject(lexicalGlobalObject);

    if (!modeLabel.isEmpty()) {
        result->putDirect(vm, JSC::Identifier::fromString(vm, "mode"_s), jsString(vm, String::fromUTF8(modeLabel)));
    }

    result->putDirect(vm, JSC::Identifier::fromString(vm, "name"_s), jsString(vm, name.convertToASCIILowercase()));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "nid"_s), jsNumber(cipher.getNid()));

    if (!cipher.isStreamMode()) {
        result->putDirect(vm, JSC::Identifier::fromString(vm, "blockSize"_s), jsNumber(blockSize));
    }

    if (ivLength != 0) {
        result->putDirect(vm, JSC::Identifier::fromString(vm, "ivLength"_s), jsNumber(ivLength));
    }

    result->putDirect(vm, JSC::Identifier::fromString(vm, "keyLength"_s), jsNumber(keyLength));

    return JSValue::encode(result);
}

JSValue createNodeCryptoBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "certVerifySpkac"_s)),
        JSFunction::create(vm, globalObject, 1, "verifySpkac"_s, jsCertVerifySpkac, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "certExportPublicKey"_s)),
        JSFunction::create(vm, globalObject, 1, "certExportPublicKey"_s, jsCertExportPublicKey, ImplementationVisibility::Public, NoIntrinsic), 1);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "certExportChallenge"_s)),
        JSFunction::create(vm, globalObject, 1, "certExportChallenge"_s, jsCertExportChallenge, ImplementationVisibility::Public, NoIntrinsic), 1);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getCurves"_s)),
        JSFunction::create(vm, globalObject, 0, "getCurves"_s, jsGetCurves, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getCiphers"_s)),
        JSFunction::create(vm, globalObject, 0, "getCiphers"_s, jsGetCiphers, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getCipherInfo"_s)),
        JSFunction::create(vm, globalObject, 1, "getCipherInfo"_s, jsGetCipherInfo, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "Sign"_s)),
        globalObject->m_JSSignClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "sign"_s)),
        JSFunction::create(vm, globalObject, 4, "sign"_s, jsSignOneShot, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "Verify"_s)),
        globalObject->m_JSVerifyClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "verify"_s)),
        JSFunction::create(vm, globalObject, 4, "verify"_s, jsVerifyOneShot, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "Hmac"_s)),
        globalObject->m_JSHmacClassStructure.constructor(globalObject));

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "Hash"_s)),
        globalObject->m_JSHashClassStructure.constructor(globalObject));

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "ECDH"_s)),
        globalObject->m_JSECDHClassStructure.constructor(globalObject));

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "DiffieHellman"_s)),
        globalObject->m_JSDiffieHellmanClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "DiffieHellmanGroup"_s)),
        globalObject->m_JSDiffieHellmanGroupClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "diffieHellman"_s)),
        JSFunction::create(vm, globalObject, 2, "diffieHellman"_s, jsDiffieHellman, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "generatePrime"_s)),
        JSFunction::create(vm, globalObject, 3, "generatePrime"_s, jsGeneratePrime, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "generatePrimeSync"_s)),
        JSFunction::create(vm, globalObject, 2, "generatePrimeSync"_s, jsGeneratePrimeSync, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "checkPrime"_s)),
        JSFunction::create(vm, globalObject, 3, "checkPrime"_s, jsCheckPrime, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "checkPrimeSync"_s)),
        JSFunction::create(vm, globalObject, 2, "checkPrimeSync"_s, jsCheckPrimeSync, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "Cipher"_s)),
        globalObject->m_JSCipherClassStructure.constructor(globalObject));

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "hkdf"_s)),
        JSFunction::create(vm, globalObject, 6, "hkdf"_s, jsHkdf, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "hkdfSync"_s)),
        JSFunction::create(vm, globalObject, 5, "hkdfSync"_s, jsHkdfSync, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "KeyObject"_s)),
        globalObject->m_JSKeyObjectClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "SecretKeyObject"_s)),
        globalObject->m_JSSecretKeyObjectClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "PublicKeyObject"_s)),
        globalObject->m_JSPublicKeyObjectClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "PrivateKeyObject"_s)),
        globalObject->m_JSPrivateKeyObjectClassStructure.constructor(globalObject));

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "publicEncrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "publicEncrypt"_s, jsPublicEncrypt, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "publicDecrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "publicDecrypt"_s, jsPublicDecrypt, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "privateEncrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "privateEncrypt"_s, jsPrivateEncrypt, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "privateDecrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "privateDecrypt"_s, jsPrivateDecrypt, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "createSecretKey"_s)),
        JSFunction::create(vm, globalObject, 2, "createSecretKey"_s, jsCreateSecretKey, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "createPublicKey"_s)),
        JSFunction::create(vm, globalObject, 1, "createPublicKey"_s, jsCreatePublicKey, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "createPrivateKey"_s)),
        JSFunction::create(vm, globalObject, 1, "createPrivateKey"_s, jsCreatePrivateKey, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "generateKey"_s)),
        JSFunction::create(vm, globalObject, 3, "generateKey"_s, jsGenerateKey, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "generateKeySync"_s)),
        JSFunction::create(vm, globalObject, 2, "generateKeySync"_s, jsGenerateKeySync, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "generateKeyPair"_s)),
        JSFunction::create(vm, globalObject, 3, "generateKeyPair"_s, jsGenerateKeyPair, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "generateKeyPairSync"_s)),
        JSFunction::create(vm, globalObject, 2, "generateKeyPairSync"_s, jsGenerateKeyPairSync, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, Identifier::fromString(vm, "X509Certificate"_s),
        globalObject->m_JSX509CertificateClassStructure.constructor(globalObject));

    return obj;
}

} // namespace Bun
