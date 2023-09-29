
#include "KeyObject.h"
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
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/x509.h>
#include <openssl/pem.h>
#include "JSBuffer.h"

using namespace JSC;
using namespace Bun;
using JSGlobalObject
    = JSC::JSGlobalObject;
using Exception = JSC::Exception;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;

namespace WebCore {

static bool WebCrypto__IsASN1Sequence(const unsigned char* data, size_t size,
    size_t* data_offset, size_t* data_size)
{
    if (size < 2 || data[0] != 0x30)
        return false;

    if (data[1] & 0x80) {
        // Long form.
        size_t n_bytes = data[1] & ~0x80;
        if (n_bytes + 2 > size || n_bytes > sizeof(size_t))
            return false;
        size_t length = 0;
        for (size_t i = 0; i < n_bytes; i++)
            length = (length << 8) | data[i + 2];
        *data_offset = 2 + n_bytes;
        *data_size = std::min(size - 2 - n_bytes, length);
    } else {
        // Short form.
        *data_offset = 2;
        *data_size = std::min<size_t>(size - 2, data[1]);
    }

    return true;
}
static bool WebCrypto__IsRSAPrivateKey(const unsigned char* data, size_t size)
{
    // Both RSAPrivateKey and RSAPublicKey structures start with a SEQUENCE.
    size_t offset, len;
    if (!WebCrypto__IsASN1Sequence(data, size, &offset, &len))
        return false;

    // An RSAPrivateKey sequence always starts with a single-byte integer whose
    // value is either 0 or 1, whereas an RSAPublicKey starts with the modulus
    // (which is the product of two primes and therefore at least 4), so we can
    // decide the type of the structure based on the first three bytes of the
    // sequence.
    return len >= 3 && data[offset] == 2 && data[offset + 1] == 1 && !(data[offset + 2] & 0xfe);
}

static bool WebCrypto__IsEncryptedPrivateKeyInfo(const unsigned char* data, size_t size)
{
    // Both PrivateKeyInfo and EncryptedPrivateKeyInfo start with a SEQUENCE.
    size_t offset, len;
    if (!WebCrypto__IsASN1Sequence(data, size, &offset, &len))
        return false;

    // A PrivateKeyInfo sequence always starts with an integer whereas an
    // EncryptedPrivateKeyInfo starts with an AlgorithmIdentifier.
    return len >= 1 && data[offset] != 2;
}

JSC::EncodedJSValue WebCrypto__createSecretKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    JSValue bufferArg = callFrame->uncheckedArgument(0);

    if (bufferArg.isCell()) {
        auto type = bufferArg.asCell()->type();

        switch (type) {

        case DataViewType:
        case Uint8ArrayType:
        case Uint8ClampedArrayType:
        case Uint16ArrayType:
        case Uint32ArrayType:
        case Int8ArrayType:
        case Int16ArrayType:
        case Int32ArrayType:
        case Float32ArrayType:
        case Float64ArrayType:
        case BigInt64ArrayType:
        case BigUint64ArrayType: {
            JSC::JSArrayBufferView* view = jsCast<JSC::JSArrayBufferView*>(bufferArg.asCell());

            void* data = view->vector();
            size_t byteLength = view->length();
            if (UNLIKELY(!data)) {
                break;
            }
            Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
            auto& vm = globalObject->vm();
            auto* structure = globalObject->JSCryptoKeyStructure();
            auto impl = CryptoKeyHMAC::generateFromBytes(data, byteLength, CryptoAlgorithmIdentifier::HMAC, true, CryptoKeyUsageSign | CryptoKeyUsageVerify).releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, globalObject, WTFMove(impl)));
        }
        case ArrayBufferType: {
            auto* jsBuffer = jsCast<JSC::JSArrayBuffer*>(bufferArg.asCell());
            if (UNLIKELY(!jsBuffer)) {
                break;
            }
            RefPtr<ArrayBuffer> buffer = jsBuffer->impl();
            void* data = buffer->data();
            size_t byteLength = buffer->byteLength();
            if (UNLIKELY(!byteLength)) {
                break;
            }
            Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
            auto& vm = globalObject->vm();
            auto* structure = globalObject->JSCryptoKeyStructure();
            auto impl = CryptoKeyHMAC::generateFromBytes(data, byteLength, CryptoAlgorithmIdentifier::HMAC, true, CryptoKeyUsageSign | CryptoKeyUsageVerify).releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, globalObject, WTFMove(impl)));
        }
        default:
            break;
        }
    }
    {
        auto& vm = lexicalGlobalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_INVALID_ARG_TYPE: expected Buffer or array-like object"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
}
JSC::EncodedJSValue WebCrypto__AsymmetricKeyType(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    static const NeverDestroyed<String> values[] = {
        MAKE_STATIC_STRING_IMPL("rsa"),
        MAKE_STATIC_STRING_IMPL("rsa-pss"),
        MAKE_STATIC_STRING_IMPL("dsa"),
        MAKE_STATIC_STRING_IMPL("dh"),
        MAKE_STATIC_STRING_IMPL("X25519"),
        MAKE_STATIC_STRING_IMPL("ed25519"),
    };

    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        auto id = key->wrapped().algorithmIdentifier();
        switch (id) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), values[0]));
        case CryptoAlgorithmIdentifier::RSA_PSS:
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), values[1]));
        case CryptoAlgorithmIdentifier::ECDSA:
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), values[2]));
        case CryptoAlgorithmIdentifier::ECDH:
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), values[3]));
        case CryptoAlgorithmIdentifier::Ed25519: {
            const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(key->wrapped());
            // TODO: CHECK THIS WHEN X488 AND ED448 ARE ADDED
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), String(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? values[4] : values[5])));
        }
        default:
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

struct AsymmetricKeyValue {
    EVP_PKEY* key;
    bool owned;
};

static Vector<uint8_t> GetRawKeyFromSecret(WebCore::CryptoKey& key)
{
    auto id = key.keyClass();
    switch (id) {
    case CryptoKeyClass::HMAC: {
        const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(key);
        return hmac.key();
    }
    case CryptoKeyClass::AES: {
        const auto& aes = downcast<WebCore::CryptoKeyAES>(key);
        return aes.key();
    }
    case CryptoKeyClass::OKP: {
        const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(key);
        return okpKey.platformKey();
    }
    case CryptoKeyClass::Raw: {
        const auto& raw = downcast<WebCore::CryptoKeyRaw>(key);
        return raw.key();
    }
    default: {
        Vector<uint8_t> empty;
        return empty;
    }
    }
}
static AsymmetricKeyValue GetInternalAsymmetricKey(WebCore::CryptoKey& key)
{
    auto id = key.algorithmIdentifier();
    switch (id) {
    case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSA_OAEP:
    case CryptoAlgorithmIdentifier::RSA_PSS:
        return (AsymmetricKeyValue) { .key = downcast<WebCore::CryptoKeyRSA>(key).platformKey(), .owned = false };
    case CryptoAlgorithmIdentifier::ECDSA:
    case CryptoAlgorithmIdentifier::ECDH:
        return (AsymmetricKeyValue) { .key = downcast<WebCore::CryptoKeyEC>(key).platformKey(), .owned = false };
    case CryptoAlgorithmIdentifier::Ed25519: {
        const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(key);
        auto keyData = okpKey.exportKey();
        // TODO: CHECK THIS WHEN X488 AND ED448 ARE ADDED
        if (okpKey.type() == CryptoKeyType::Private) {
            auto* evp_key = EVP_PKEY_new_raw_private_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
            return (AsymmetricKeyValue) { .key = evp_key, .owned = true };
        } else {
            auto* evp_key = EVP_PKEY_new_raw_public_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
            return (AsymmetricKeyValue) { .key = evp_key, .owned = true };
        }
    }
    default:
        return (AsymmetricKeyValue) { .key = NULL, .owned = false };
    }
}

JSC::EncodedJSValue WebCrypto__Exports(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{

    auto count = callFrame->argumentCount();
    auto& vm = globalObject->vm();

    if (count < 1) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "exports requires 1 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {

        auto& wrapped = key->wrapped();
        auto key_type = wrapped.type();
        auto id = wrapped.keyClass();
        if (count > 1) {
            if (auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1))) {
                JSValue formatJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "format"_s)));
                JSValue typeJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "type"_s)));
                auto string = formatJSValue.toWTFString(globalObject);
                if (string.isNull()) {
                    auto scope = DECLARE_THROW_SCOPE(vm);
                    JSC::throwTypeError(globalObject, scope, "format is expected to be a string"_s);
                    return JSC::JSValue::encode(JSC::JSValue {});
                }

                switch (id) {
                case CryptoKeyClass::HMAC: {
                    const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(wrapped);
                    if (string == "buffer"_s) {
                        auto keyData = hmac.key();
                        auto size = keyData.size();
                        auto* buffer = jsCast<JSUint8Array*>(JSValue::decode(JSBuffer__bufferFromLength(globalObject, size)));
                        if (size > 0)
                            memcpy(buffer->vector(), keyData.data(), size);

                        return JSC::JSValue::encode(buffer);
                    } else if (string == "jwk"_s) {
                        const JsonWebKey& jwkValue = hmac.exportJwk();
                        Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                        return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue));
                    }
                    break;
                }
                case CryptoKeyClass::AES: {
                    const auto& aes = downcast<WebCore::CryptoKeyAES>(wrapped);
                    if (string == "buffer"_s) {
                        auto keyData = aes.key();
                        auto size = keyData.size();
                        auto* buffer = jsCast<JSUint8Array*>(JSValue::decode(JSBuffer__bufferFromLength(globalObject, size)));
                        if (size > 0)
                            memcpy(buffer->vector(), keyData.data(), size);

                        return JSC::JSValue::encode(buffer);
                    } else if (string == "jwk"_s) {
                        const JsonWebKey& jwkValue = aes.exportJwk();
                        Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                        return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue));
                    }
                    break;
                }
                case CryptoKeyClass::RSA: {
                    const auto& rsa = downcast<WebCore::CryptoKeyRSA>(wrapped);
                    if (string == "jwk"_s) {
                        const JsonWebKey& jwkValue = rsa.exportJwk();
                        Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                        return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue));
                    } else {
                        auto type = !typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty() ? typeJSValue.toWTFString(globalObject) : "pkcs1"_s;
                        if (type.isNull()) {
                            auto scope = DECLARE_THROW_SCOPE(vm);
                            JSC::throwTypeError(globalObject, scope, "type is expected to be a string"_s);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }

                        auto* bio = BIO_new(BIO_s_mem());
                        auto* rsaKey = rsa.platformKey();
                        auto* rsa_ptr = EVP_PKEY_get1_RSA(rsaKey);

                        if (key_type == CryptoKeyType::Public) {
                            if (string == "pem"_s) {
                                if (type == "pkcs1"_s) {
                                    if (PEM_write_bio_RSAPublicKey(bio, rsa_ptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else if (type == "spki"_s) {
                                    if (PEM_write_bio_PUBKEY(bio, rsaKey) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }

                            } else if (string == "der"_s) {
                                if (type == "pkcs1"_s) {
                                    if (i2d_RSAPublicKey_bio(bio, rsa_ptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else if (type == "spki"_s) {
                                    if (i2d_PUBKEY_bio(bio, rsaKey) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else {
                                auto scope = DECLARE_THROW_SCOPE(vm);
                                JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSValue passphraseJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
                            JSValue cipherJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                            const EVP_CIPHER* cipher;
                            if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty()) {
                                auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                                if (!cipher_wtfstr.isNull()) {
                                    auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                                    if (!cipherOrError) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    } else {
                                        auto cipher_str = cipherOrError->data();
                                        if (cipher_str != nullptr) {
                                            cipher = EVP_get_cipherbyname(cipher_str);
                                        } else {
                                            cipher = nullptr;
                                        }
                                    }
                                } else {
                                    cipher = nullptr;
                                }
                            } else {
                                cipher = nullptr;
                            }
                            void* passphrase;
                            size_t passphrase_len = 0;
                            if (auto* passphraseBuffer = jsCast<JSUint8Array*>(passphraseJSValue)) {
                                passphrase = passphraseBuffer->vector();
                                passphrase_len = passphraseBuffer->byteLength();
                            } else {
                                if (!passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty()) {
                                    auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                                    if (!passphrase_wtfstr.isNull()) {
                                        if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                                            passphrase = const_cast<char*>(pass->data());
                                            passphrase_len = pass->length();
                                        } else {
                                            passphrase = nullptr;
                                        }
                                    } else {
                                        passphrase = nullptr;
                                    }
                                } else {
                                    passphrase = nullptr;
                                }
                            }

                            if (string == "pem"_s) {
                                if (type == "pkcs1"_s) {
                                    if (PEM_write_bio_RSAPrivateKey(bio, rsa_ptr, cipher, (unsigned char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else if (type == "pkcs8"_s) {
                                    if (PEM_write_bio_PKCS8PrivateKey(bio, rsaKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'pkcs8'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else if (string == "der"_s) {
                                if (type == "pkcs1"_s) {
                                    if (i2d_RSAPrivateKey_bio(bio, rsa_ptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else if (type == "pkcs8"_s) {
                                    if (i2d_PKCS8PrivateKey_bio(bio, rsaKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'pkcs8'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else {
                                auto scope = DECLARE_THROW_SCOPE(vm);
                                JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        }

                        BUF_MEM* bptr;
                        BIO_get_mem_ptr(bio, &bptr);
                        auto length = bptr->length;
                        if (string == "pem"_s) {
                            auto str = WTF::String::fromUTF8(bptr->data, length);
                            return JSValue::encode(JSC::jsString(vm, str));
                        }

                        auto* buffer = jsCast<JSUint8Array*>(JSValue::decode(JSBuffer__bufferFromLength(globalObject, length)));
                        if (length > 0)
                            memcpy(buffer->vector(), bptr->data, length);

                        BIO_free(bio);
                        return JSC::JSValue::encode(buffer);
                    }
                }
                case CryptoKeyClass::EC: {
                    const auto& ec = downcast<WebCore::CryptoKeyEC>(wrapped);
                    if (string == "jwk"_s) {
                        auto result = ec.exportJwk();
                        if (result.hasException()) {
                            auto scope = DECLARE_THROW_SCOPE(vm);
                            WebCore::propagateException(*globalObject, scope, result.releaseException());
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                        const JsonWebKey& jwkValue = result.releaseReturnValue();
                        Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                        return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue));
                    } else {
                        auto type = !typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty() ? typeJSValue.toWTFString(globalObject) : "spki"_s;
                        if (type.isNull()) {
                            auto scope = DECLARE_THROW_SCOPE(vm);
                            JSC::throwTypeError(globalObject, scope, "type is expected to be a string"_s);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }

                        auto* bio = BIO_new(BIO_s_mem());
                        auto* ecKey = ec.platformKey();
                        auto* ec_ptr = EVP_PKEY_get1_EC_KEY(ecKey);

                        if (key_type == CryptoKeyType::Public) {
                            if (string == "pem"_s) {
                                if (type == "spki"_s) {
                                    if (PEM_write_bio_PUBKEY(bio, ecKey) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }

                            } else if (string == "der"_s) {
                                if (type == "spki"_s) {
                                    if (i2d_PUBKEY_bio(bio, ecKey) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else {
                                auto scope = DECLARE_THROW_SCOPE(vm);
                                JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSValue passphraseJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
                            JSValue cipherJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                            const EVP_CIPHER* cipher;
                            if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty()) {
                                auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                                if (!cipher_wtfstr.isNull()) {
                                    auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                                    if (!cipherOrError) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    } else {
                                        auto cipher_str = cipherOrError->data();
                                        if (cipher_str != nullptr) {
                                            cipher = EVP_get_cipherbyname(cipher_str);
                                        } else {
                                            cipher = nullptr;
                                        }
                                    }
                                } else {
                                    cipher = nullptr;
                                }
                            } else {
                                cipher = nullptr;
                            }
                            void* passphrase;
                            size_t passphrase_len = 0;
                            if (auto* passphraseBuffer = jsCast<JSUint8Array*>(passphraseJSValue)) {
                                passphrase = passphraseBuffer->vector();
                                passphrase_len = passphraseBuffer->byteLength();
                            } else {
                                if (!passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty()) {
                                    auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                                    if (!passphrase_wtfstr.isNull()) {
                                        if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                                            passphrase = const_cast<char*>(pass->data());
                                            passphrase_len = pass->length();
                                        } else {
                                            passphrase = nullptr;
                                        }
                                    } else {
                                        passphrase = nullptr;
                                    }
                                } else {
                                    passphrase = nullptr;
                                }
                            }

                            if (string == "pem"_s) {
                                if (type == "sec1"_s) {
                                    if (PEM_write_bio_ECPrivateKey(bio, ec_ptr, cipher, (unsigned char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else if (type == "pkcs8"_s) {
                                    if (PEM_write_bio_PKCS8PrivateKey(bio, ecKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'sec1' or 'pkcs8'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else if (string == "der"_s) {
                                if (type == "sec1"_s) {
                                    if (i2d_ECPrivateKey_bio(bio, ec_ptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else if (type == "pkcs8"_s) {
                                    if (i2d_PKCS8PrivateKey_bio(bio, ecKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'sec1' or 'pkcs8'"_s);
                                    BIO_free(bio);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else {
                                auto scope = DECLARE_THROW_SCOPE(vm);
                                JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        }

                        BUF_MEM* bptr;
                        BIO_get_mem_ptr(bio, &bptr);
                        auto length = bptr->length;
                        if (string == "pem"_s) {
                            auto str = WTF::String::fromUTF8(bptr->data, length);
                            return JSValue::encode(JSC::jsString(vm, str));
                        }

                        auto* buffer = jsCast<JSUint8Array*>(JSValue::decode(JSBuffer__bufferFromLength(globalObject, length)));
                        if (length > 0)
                            memcpy(buffer->vector(), bptr->data, length);

                        BIO_free(bio);
                        return JSC::JSValue::encode(buffer);
                    }
                }
                case CryptoKeyClass::OKP: {
                    const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(wrapped);
                    if (string == "jwk"_s) {
                        auto result = okpKey.exportJwk();
                        if (result.hasException()) {
                            auto scope = DECLARE_THROW_SCOPE(vm);
                            WebCore::propagateException(*globalObject, scope, result.releaseException());
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                        const JsonWebKey& jwkValue = result.releaseReturnValue();
                        Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                        return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue));
                    } else {
                        auto type = !typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty() ? typeJSValue.toWTFString(globalObject) : "spki"_s;
                        if (type.isNull()) {
                            auto scope = DECLARE_THROW_SCOPE(vm);
                            JSC::throwTypeError(globalObject, scope, "type is expected to be a string"_s);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }

                        auto keyData = okpKey.exportKey();
                        auto* bio = BIO_new(BIO_s_mem());

                        EVP_PKEY* evpKey;
                        // TODO: CHECK THIS WHEN X488 AND ED448 ARE ADDED
                        if (okpKey.type() == CryptoKeyType::Private) {
                            evpKey = EVP_PKEY_new_raw_private_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
                            JSValue passphraseJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
                            JSValue cipherJSValue = options->getDirect(vm, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                            const EVP_CIPHER* cipher;
                            if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty()) {
                                auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                                if (!cipher_wtfstr.isNull()) {
                                    auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                                    if (!cipherOrError) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                        BIO_free(bio);
                                        EVP_PKEY_free(evpKey);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    } else {
                                        auto cipher_str = cipherOrError->data();
                                        if (cipher_str != nullptr) {
                                            cipher = EVP_get_cipherbyname(cipher_str);
                                        } else {
                                            cipher = nullptr;
                                        }
                                    }
                                } else {
                                    cipher = nullptr;
                                }
                            } else {
                                cipher = nullptr;
                            }
                            void* passphrase;
                            size_t passphrase_len = 0;
                            if (auto* passphraseBuffer = jsCast<JSUint8Array*>(passphraseJSValue)) {
                                passphrase = passphraseBuffer->vector();
                                passphrase_len = passphraseBuffer->byteLength();
                            } else {
                                if (!passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty()) {
                                    auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                                    if (!passphrase_wtfstr.isNull()) {
                                        if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                                            passphrase = const_cast<char*>(pass->data());
                                            passphrase_len = pass->length();
                                        } else {
                                            passphrase = nullptr;
                                        }
                                    } else {
                                        passphrase = nullptr;
                                    }
                                } else {
                                    passphrase = nullptr;
                                }
                            }

                            if (string == "pem"_s) {
                                if (type == "pkcs8"_s) {
                                    if (PEM_write_bio_PKCS8PrivateKey(bio, evpKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        EVP_PKEY_free(evpKey);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'pkcs8'"_s);
                                    BIO_free(bio);
                                    EVP_PKEY_free(evpKey);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else if (string == "der"_s) {
                                if (type == "pkcs8"_s) {
                                    if (i2d_PKCS8PrivateKey_bio(bio, evpKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                        BIO_free(bio);
                                        EVP_PKEY_free(evpKey);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'pkcs8'"_s);
                                    BIO_free(bio);
                                    EVP_PKEY_free(evpKey);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else {
                                auto scope = DECLARE_THROW_SCOPE(vm);
                                JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            evpKey = EVP_PKEY_new_raw_public_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
                            if (string == "pem"_s) {
                                if (type == "spki"_s) {
                                    if (PEM_write_bio_PUBKEY(bio, evpKey) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        EVP_PKEY_free(evpKey);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                                    BIO_free(bio);
                                    EVP_PKEY_free(evpKey);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }

                            } else if (string == "der"_s) {
                                if (type == "spki"_s) {
                                    if (i2d_PUBKEY_bio(bio, evpKey) != 1) {
                                        auto scope = DECLARE_THROW_SCOPE(vm);
                                        JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                        BIO_free(bio);
                                        EVP_PKEY_free(evpKey);
                                        return JSC::JSValue::encode(JSC::JSValue {});
                                    }
                                } else {
                                    auto scope = DECLARE_THROW_SCOPE(vm);
                                    JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                                    BIO_free(bio);
                                    EVP_PKEY_free(evpKey);
                                    return JSC::JSValue::encode(JSC::JSValue {});
                                }
                            } else {
                                auto scope = DECLARE_THROW_SCOPE(vm);
                                JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        }

                        BUF_MEM* bptr;
                        BIO_get_mem_ptr(bio, &bptr);
                        auto length = bptr->length;
                        if (string == "pem"_s) {
                            auto str = WTF::String::fromUTF8(bptr->data, length);
                            EVP_PKEY_free(evpKey);
                            return JSValue::encode(JSC::jsString(vm, str));
                        }

                        auto* buffer = jsCast<JSUint8Array*>(JSValue::decode(JSBuffer__bufferFromLength(globalObject, length)));
                        if (length > 0)
                            memcpy(buffer->vector(), bptr->data, length);

                        BIO_free(bio);
                        EVP_PKEY_free(evpKey);
                        return JSC::JSValue::encode(buffer);
                    }
                }
                case CryptoKeyClass::Raw: {
                    const auto& raw = downcast<WebCore::CryptoKeyRaw>(wrapped);
                    if (string == "buffer"_s) {
                        auto keyData = raw.key();
                        auto size = keyData.size();
                        auto* buffer = jsCast<JSUint8Array*>(JSValue::decode(JSBuffer__bufferFromLength(globalObject, size)));
                        if (size > 0)
                            memcpy(buffer->vector(), keyData.data(), size);

                        return JSC::JSValue::encode(buffer);
                    }

                    auto scope = DECLARE_THROW_SCOPE(vm);
                    JSC::throwTypeError(globalObject, scope, "format is expected to be 'buffer'"_s);
                    return JSC::JSValue::encode(JSC::JSValue {});
                }
                default: {
                    auto scope = DECLARE_THROW_SCOPE(vm);
                    JSC::throwTypeError(globalObject, scope, "Invalid Operation"_s);
                    return JSC::JSValue::encode(JSC::JSValue {});
                }
                }
                auto scope = DECLARE_THROW_SCOPE(vm);
                JSC::throwTypeError(globalObject, scope, "format is expected to be 'buffer' or 'jwk'"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            } else {
                auto scope = DECLARE_THROW_SCOPE(vm);
                JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
        }
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    // No JSCryptoKey instance
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "expected CryptoKey as first argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
}

JSC::EncodedJSValue WebCrypto__Equals(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        if (auto* key2 = jsDynamicCast<JSCryptoKey*>(callFrame->argument(1))) {
            auto& wrapped = key->wrapped();
            auto& wrapped2 = key2->wrapped();
            auto key_type = wrapped.type();
            auto key_class = wrapped.keyClass();
            if (key_type != wrapped2.type()) {
                return JSC::JSValue::encode(jsBoolean(false));
            }

            if (key_type == CryptoKeyType::Secret) {
                auto keyData = GetRawKeyFromSecret(wrapped);
                auto keyData2 = GetRawKeyFromSecret(wrapped2);
                auto size = keyData.size();

                if (size != keyData2.size()) {
                    return JSC::JSValue::encode(jsBoolean(false));
                }
                return JSC::JSValue::encode(jsBoolean(CRYPTO_memcmp(keyData.data(), keyData2.data(), size) == 0));
            }
            auto evp_key = GetInternalAsymmetricKey(wrapped);
            auto evp_key2 = GetInternalAsymmetricKey(wrapped2);

            int ok = !evp_key.key || !evp_key2.key ? -2 : EVP_PKEY_cmp(evp_key.key, evp_key2.key);

            if (evp_key.key && evp_key.owned) {
                EVP_PKEY_free(evp_key.key);
            }
            if (evp_key2.key && evp_key2.owned) {
                EVP_PKEY_free(evp_key2.key);
            }
            if (ok == -2) {
                auto& vm = lexicalGlobalObject->vm();
                auto scope = DECLARE_THROW_SCOPE(vm);
                throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_CRYPTO_UNSUPPORTED_OPERATION"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            return JSC::JSValue::encode(jsBoolean(ok == 1));
        }
    }
    return JSC::JSValue::encode(jsBoolean(false));
}

JSC::EncodedJSValue WebCrypto__SymmetricKeySize(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        auto& wrapped = key->wrapped();
        auto id = wrapped.keyClass();
        size_t size = 0;
        switch (id) {
        case CryptoKeyClass::HMAC: {
            const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(wrapped);
            auto keyData = hmac.key();
            size = keyData.size();
            break;
        }
        case CryptoKeyClass::AES: {
            const auto& aes = downcast<WebCore::CryptoKeyAES>(wrapped);
            auto keyData = aes.key();
            size = keyData.size();
            break;
        }
        case CryptoKeyClass::Raw: {
            const auto& raw = downcast<WebCore::CryptoKeyRaw>(wrapped);
            auto keyData = raw.key();
            size = keyData.size();
            break;
        }
        default: {
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
        }

        if (!size) {
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        return JSC::JSValue::encode(JSC::jsNumber(size));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

}