// Attribution: Some parts of of this module are derived from code originating from the Node.js
// crypto module which is licensed under an MIT license:
//
// Copyright Node.js contributors. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.

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
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "headers-handwritten.h"
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/x509.h>
#include <openssl/pem.h>
#include <openssl/curve25519.h>
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

static bool KeyObject__IsASN1Sequence(const unsigned char* data, size_t size,
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
static bool KeyObject__IsRSAPrivateKey(const unsigned char* data, size_t size)
{
    // Both RSAPrivateKey and RSAPublicKey structures start with a SEQUENCE.
    size_t offset, len;
    if (!KeyObject__IsASN1Sequence(data, size, &offset, &len))
        return false;

    // An RSAPrivateKey sequence always starts with a single-byte integer whose
    // value is either 0 or 1, whereas an RSAPublicKey starts with the modulus
    // (which is the product of two primes and therefore at least 4), so we can
    // decide the type of the structure based on the first three bytes of the
    // sequence.
    return len >= 3 && data[offset] == 2 && data[offset + 1] == 1 && !(data[offset + 2] & 0xfe);
}

static bool KeyObject__IsEncryptedPrivateKeyInfo(const unsigned char* data, size_t size)
{
    // Both PrivateKeyInfo and EncryptedPrivateKeyInfo start with a SEQUENCE.
    size_t offset, len;
    if (!KeyObject__IsASN1Sequence(data, size, &offset, &len))
        return false;

    // A PrivateKeyInfo sequence always starts with an integer whereas an
    // EncryptedPrivateKeyInfo starts with an AlgorithmIdentifier.
    return len >= 1 && data[offset] != 2;
}

struct AsymmetricKeyValue {
    EVP_PKEY* key;
    bool owned;
};

struct AsymmetricKeyValueWithDER {
    EVP_PKEY* key;
    unsigned char* der_data;
    long der_len;
};

struct PrivateKeyPassphrase {
    char* passphrase;
    size_t passphrase_len;
};

int PasswordCallback(char* buf, int size, int rwflag, void* u)
{
    auto result = static_cast<PrivateKeyPassphrase*>(u);
    if (result != nullptr && size > 0 && result->passphrase != nullptr) {
        size_t buflen = static_cast<size_t>(size);
        size_t len = result->passphrase_len;
        if (buflen < len)
            return -1;
        memcpy(buf, result->passphrase, buflen);
        return len;
    }

    return -1;
}

AsymmetricKeyValueWithDER KeyObject__ParsePublicKeyPEM(const char* key_pem,
    size_t key_pem_len)
{
    auto bp = BIOPtr(BIO_new_mem_buf(const_cast<char*>(key_pem), key_pem_len));
    auto result = (AsymmetricKeyValueWithDER) { .key = nullptr, .der_data = nullptr, .der_len = 0 };

    if (!bp) {
        ERR_clear_error();
        return result;
    }

    // Try parsing as a SubjectPublicKeyInfo first.
    if (PEM_bytes_read_bio(&result.der_data, &result.der_len, nullptr, "PUBLIC KEY", bp.get(), nullptr, nullptr) == 1) {
        // OpenSSL might modify the pointer, so we need to make a copy before parsing.
        const unsigned char* p = result.der_data;
        result.key = d2i_PUBKEY(nullptr, &p, result.der_len);
        if (result.key) {
            return result;
        }
    }

    ERR_clear_error();
    BIO_reset(bp.get());

    // Maybe it is PKCS#1.
    if (PEM_bytes_read_bio(&result.der_data, &result.der_len, nullptr, "RSA PUBLIC KEY", bp.get(), nullptr, nullptr) == 1) {
        const unsigned char* p = result.der_data;
        result.key = d2i_PublicKey(EVP_PKEY_RSA, nullptr, &p, result.der_len);
        if (result.key) {
            return result;
        }
    }
    ERR_clear_error();
    BIO_reset(bp.get());

    // X.509 fallback.
    if (PEM_bytes_read_bio(&result.der_data, &result.der_len, nullptr, "CERTIFICATE", bp.get(), nullptr, nullptr) == 1) {
        const unsigned char* p = result.der_data;
        X509Ptr x509(d2i_X509(nullptr, &p, result.der_len));
        result.key = x509 ? X509_get_pubkey(x509.get()) : nullptr;
        if (result.key) {
            return result;
        }
        OPENSSL_clear_free(result.der_data, result.der_len);
        ERR_clear_error();
        result.der_data = nullptr;
        result.der_len = 0;
    } else {
        OPENSSL_clear_free(result.der_data, result.der_len);
        ERR_clear_error();
        result.der_data = nullptr;
        result.der_len = 0;
    }
    return result;
}

JSC::EncodedJSValue KeyObject__createPrivateKey(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{

    auto count = callFrame->argumentCount();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 1) {
        JSC::throwTypeError(globalObject, scope, "createPrivateKey requires 1 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(0));
    if (!options) {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSValue keyJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "key"_s)));
    if (keyJSValue.isUndefinedOrNull() || keyJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "key is required"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    if (!keyJSValue.isCell()) {
        JSC::throwTypeError(globalObject, scope, "key must be a Buffer, Array-like or object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSValue formatJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "format"_s)));
    if (formatJSValue.isUndefinedOrNull() || formatJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "format is required"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (!formatJSValue.isString()) {
        JSC::throwTypeError(globalObject, scope, "format must be a string"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto format = formatJSValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    void* data;
    size_t byteLength;

    auto keyJSValueCell = keyJSValue.asCell();
    auto type = keyJSValueCell->type();

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
        JSC::JSArrayBufferView* view = jsCast<JSC::JSArrayBufferView*>(keyJSValueCell);

        data = view->vector();
        byteLength = view->length();
        break;
    }
    case ArrayBufferType: {
        auto* jsBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(keyJSValueCell);
        if (UNLIKELY(!jsBuffer)) {
            throwException(globalObject, scope, createTypeError(globalObject, "ERR_INVALID_ARG_TYPE: expected key to be Buffer or array-like object"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        auto* buffer = jsBuffer->impl();
        data = buffer->data();
        byteLength = buffer->byteLength();
        break;
    }
    default: {
        if (auto* keyObj = jsDynamicCast<JSC::JSObject*>(keyJSValue)) {
            if (format != "jwk"_s) {
                JSC::throwTypeError(globalObject, scope, "format should be 'jwk' when key type is 'object'"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            auto jwk = WebCore::convertDictionary<JsonWebKey>(*globalObject, keyJSValue);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
            if (jwk.kty == "OKP"_s) {
                if (jwk.crv == "Ed25519"_s) {
                    auto result = CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(jwk), true, CryptoKeyUsageSign);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 private key"_s));
                        return JSValue::encode(JSC::jsUndefined());
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() != CryptoKeyType::Private) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                        return JSValue::encode(JSC::jsUndefined());
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else if (jwk.crv == "X25519"_s) {
                    auto result = CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, WTFMove(jwk), true, CryptoKeyUsageSign);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 private key"_s));
                        return JSValue::encode(JSC::jsUndefined());
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() != CryptoKeyType::Private) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                        return JSValue::encode(JSC::jsUndefined());
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else {
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported OKP curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
            } else if (jwk.kty == "EC"_s) {
                auto result = CryptoKeyEC::importJwk(CryptoAlgorithmIdentifier::ECDSA, jwk.crv, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                if (impl->type() != CryptoKeyType::Private) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (jwk.kty == "RSA"_s) {
                auto result = CryptoKeyRSA::importJwk(CryptoAlgorithmIdentifier::RSA_OAEP, std::nullopt, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid RSA private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                if (impl->type() != CryptoKeyType::Private) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
        }
        JSC::throwTypeError(globalObject, scope, "The \"key\" property must be of type object"_s);
        return JSValue::encode(JSC::jsUndefined());
    }
    }

    if (format == "jwk"_s) {
        JSC::throwTypeError(globalObject, scope, "The \"key\" property must be of type object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (UNLIKELY(!data) || UNLIKELY(!byteLength)) {
        throwException(globalObject, scope, createTypeError(globalObject, "ERR_INVALID_ARG_TYPE: expected key to be Buffer or array-like object"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
    PrivateKeyPassphrase passphrase = { nullptr, 0 };

    auto hasPassphrase = !passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty();

    if (hasPassphrase) {
        if (passphraseJSValue.isString()) {
            auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
            if (!passphrase_wtfstr.isNull()) {
                if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                    if (pass.has_value()) {
                        auto value = pass.value();
                        passphrase.passphrase = const_cast<char*>(value.data());
                        passphrase.passphrase_len = value.length();
                    }
                }
            }
        } else if (auto* passphraseBuffer = jsDynamicCast<JSUint8Array*>(passphraseJSValue)) {
            passphrase.passphrase = (char*)passphraseBuffer->vector();
            passphrase.passphrase_len = passphraseBuffer->byteLength();
        } else {
            JSC::throwTypeError(globalObject, scope, "passphrase must be a Buffer or String"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
    }

    if (format == "pem"_s) {
        auto bio = BIOPtr(BIO_new_mem_buf(const_cast<char*>((char*)data), byteLength));
        auto pkey = EvpPKeyPtr(PEM_read_bio_PrivateKey(bio.get(), nullptr, PasswordCallback, &passphrase));

        if (!pkey) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key pem file"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        auto pKeyID = EVP_PKEY_id(pkey.get());

        if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageDecrypt);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_ED25519 || pKeyID == EVP_PKEY_X25519) {
            size_t out_len = 0;
            if (!EVP_PKEY_get_raw_private_key(pkey.get(), nullptr, &out_len)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            Vector<uint8_t> out(out_len);
            if (!EVP_PKEY_get_raw_private_key(pkey.get(), out.data(), &out_len) || out_len != out.size()) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto result = CryptoKeyOKP::create(CryptoAlgorithmIdentifier::Ed25519, pKeyID == EVP_PKEY_ED25519 ? CryptoKeyOKP::NamedCurve::Ed25519 : CryptoKeyOKP::NamedCurve::X25519, CryptoKeyType::Private, WTFMove(out), true, CryptoKeyUsageSign);
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_EC) {
            EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
            if (UNLIKELY(ec_key == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
            // Get the curve name
            int curve_name = EC_GROUP_get_curve_name(ec_group);
            if (curve_name == NID_undef) {
                EC_KEY_free(ec_key);
                throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            CryptoKeyEC::NamedCurve curve;
            if (curve_name == NID_X9_62_prime256v1)
                curve = CryptoKeyEC::NamedCurve::P256;
            else if (curve_name == NID_secp384r1)
                curve = CryptoKeyEC::NamedCurve::P384;
            else if (curve_name == NID_secp521r1)
                curve = CryptoKeyEC::NamedCurve::P521;
            else {
                EC_KEY_free(ec_key);
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported EC curve"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            EC_KEY_free(ec_key);
            auto impl = CryptoKeyEC::create(CryptoAlgorithmIdentifier::ECDH, curve, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageSign);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else {
            throwException(globalObject, scope, createTypeError(globalObject, "Unsupported private key"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
    }
    if (format == "der"_s) {
        JSValue typeJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "type"_s)));
        WTF::String type = "pkcs8"_s;
        if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
            if (!typeJSValue.isString()) {
                JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            type = typeJSValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
        }

        if (type == "pkcs1"_s) {
            // must be RSA
            const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
            auto pkey = EvpPKeyPtr(d2i_PrivateKey(EVP_PKEY_RSA, nullptr, &p, byteLength));
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid use of PKCS#1 as private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto pKeyID = EVP_PKEY_id(pkey.get());
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5 : CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageDecrypt);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (type == "pkcs8"_s) {

            auto bio = BIOPtr(BIO_new_mem_buf(const_cast<char*>((char*)data), byteLength));
            WebCore::EvpPKeyPtr pkey;
            if (KeyObject__IsEncryptedPrivateKeyInfo(const_cast<unsigned char*>((unsigned char*)data), byteLength)) {
                pkey = EvpPKeyPtr(d2i_PKCS8PrivateKey_bio(bio.get(),
                    nullptr,
                    PasswordCallback,
                    &passphrase));
            } else {
                auto* p8inf = d2i_PKCS8_PRIV_KEY_INFO_bio(bio.get(), nullptr);
                if (!p8inf) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid PKCS8 data"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                pkey = EvpPKeyPtr(EVP_PKCS82PKEY(p8inf));
            }
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto pKeyID = EVP_PKEY_id(pkey.get());

            if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
                auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageDecrypt);
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_ED25519) {
                auto result = CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageSign);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_X25519) {
                auto result = CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageSign);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_EC) {
                EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
                if (UNLIKELY(ec_key == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
                // Get the curve name
                int curve_name = EC_GROUP_get_curve_name(ec_group);
                if (curve_name == NID_undef) {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                CryptoKeyEC::NamedCurve curve;
                if (curve_name == NID_X9_62_prime256v1)
                    curve = CryptoKeyEC::NamedCurve::P256;
                else if (curve_name == NID_secp384r1)
                    curve = CryptoKeyEC::NamedCurve::P384;
                else if (curve_name == NID_secp521r1)
                    curve = CryptoKeyEC::NamedCurve::P521;
                else {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported EC curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto result = CryptoKeyEC::platformImportPkcs8(CryptoAlgorithmIdentifier::ECDH, curve, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageSign);
                if (UNLIKELY(result == nullptr)) {
                    result = CryptoKeyEC::platformImportPkcs8(CryptoAlgorithmIdentifier::ECDSA, curve, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageSign);
                }
                EC_KEY_free(ec_key);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
        } else if (type == "sec1"_s) {
            const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
            auto pkey = EvpPKeyPtr(d2i_PrivateKey(EVP_PKEY_EC, nullptr, &p, byteLength));
            auto pKeyID = EVP_PKEY_id(pkey.get());

            if (pKeyID == EVP_PKEY_EC) {
                EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
                if (UNLIKELY(ec_key == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
                // Get the curve name
                int curve_name = EC_GROUP_get_curve_name(ec_group);
                if (curve_name == NID_undef) {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                CryptoKeyEC::NamedCurve curve;
                if (curve_name == NID_X9_62_prime256v1)
                    curve = CryptoKeyEC::NamedCurve::P256;
                else if (curve_name == NID_secp384r1)
                    curve = CryptoKeyEC::NamedCurve::P384;
                else if (curve_name == NID_secp521r1)
                    curve = CryptoKeyEC::NamedCurve::P521;
                else {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported EC curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                EC_KEY_free(ec_key);
                auto impl = CryptoKeyEC::create(CryptoAlgorithmIdentifier::ECDH, curve, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageSign);
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
        }

        JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1', 'pkcs8' or 'sec1'"_s);
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::throwTypeError(globalObject, scope, "format should be 'pem' or 'der'"_s);
    return JSValue::encode(JSC::jsUndefined());
}

static JSC::EncodedJSValue KeyObject__createRSAFromPrivate(JSC::JSGlobalObject* globalObject, EVP_PKEY* pkey, WebCore::CryptoAlgorithmIdentifier alg)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const RSA* rsa_key = EVP_PKEY_get0_RSA(pkey);

    auto publicRSA = RSAPtr(RSAPublicKey_dup(rsa_key));
    if (!publicRSA) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto publicPKey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_RSA(publicPKey.get(), publicRSA.get()) <= 0) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto impl = CryptoKeyRSA::create(alg, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(publicPKey), true, CryptoKeyUsageVerify);
    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
}

static JSC::EncodedJSValue KeyObject__createECFromPrivate(JSC::JSGlobalObject* globalObject, EVP_PKEY* pkey, CryptoKeyEC::NamedCurve namedCurve, WebCore::CryptoAlgorithmIdentifier alg)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    EC_KEY* ec_key = EVP_PKEY_get0_EC_KEY(pkey);
    auto point = ECPointPtr(EC_POINT_dup(EC_KEY_get0_public_key(ec_key), EC_KEY_get0_group(ec_key)));
    if (!point) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 1"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto curve = NID_undef;

    switch (namedCurve) {
    case CryptoKeyEC::NamedCurve::P256:
        curve = NID_X9_62_prime256v1;
        break;
    case CryptoKeyEC::NamedCurve::P384:
        curve = NID_secp384r1;
        break;
    case CryptoKeyEC::NamedCurve::P521:
        curve = NID_secp521r1;
        break;
    }
    auto publicECKey = ECKeyPtr(EC_KEY_new_by_curve_name(curve));
    if (!publicECKey) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 2"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    // OPENSSL_EC_NAMED_CURVE needs to be set to export the key with the curve name, not with the curve parameters.
    EC_KEY_set_asn1_flag(publicECKey.get(), OPENSSL_EC_NAMED_CURVE);
    if (EC_KEY_set_public_key(publicECKey.get(), point.get()) <= 0) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 3"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto publicPKey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(publicPKey.get(), publicECKey.get()) <= 0) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 4"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto impl = CryptoKeyEC::create(alg, namedCurve, CryptoKeyType::Public, WTFMove(publicPKey), true, CryptoKeyUsageVerify);

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
}

static JSC::EncodedJSValue KeyObject__createOKPFromPrivate(JSC::JSGlobalObject* globalObject, const WebCore::CryptoKeyOKP::KeyMaterial keyData, CryptoKeyOKP::NamedCurve namedCurve, WebCore::CryptoAlgorithmIdentifier alg)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint8_t public_key[ED25519_PUBLIC_KEY_LEN];

    if (namedCurve == CryptoKeyOKP::NamedCurve::Ed25519) {
        memcpy(public_key, keyData.data() + ED25519_PRIVATE_KEY_LEN, ED25519_PUBLIC_KEY_LEN);
    } else {
        X25519_public_from_private(public_key, keyData.data());
    }
    auto result = CryptoKeyOKP::create(alg, namedCurve, CryptoKeyType::Public, Vector<uint8_t>(public_key), true, CryptoKeyUsageVerify);
    if (UNLIKELY(result == nullptr)) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private"_s);
        return JSValue::encode(JSC::jsUndefined());
    }
    auto impl = result.releaseNonNull();

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
}

static JSC::EncodedJSValue KeyObject__createPublicFromPrivate(JSC::JSGlobalObject* globalObject, EVP_PKEY* pkey)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto pKeyID = EVP_PKEY_id(pkey);
    if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
        return KeyObject__createRSAFromPrivate(globalObject, pkey, pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP);
    } else if (pKeyID == EVP_PKEY_EC) {

        EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey);
        if (UNLIKELY(ec_key == nullptr)) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC key"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
        // Get the curve name
        int curve_name = EC_GROUP_get_curve_name(ec_group);
        if (curve_name == NID_undef) {
            EC_KEY_free(ec_key);
            throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        CryptoKeyEC::NamedCurve curve;
        if (curve_name == NID_X9_62_prime256v1)
            curve = CryptoKeyEC::NamedCurve::P256;
        else if (curve_name == NID_secp384r1)
            curve = CryptoKeyEC::NamedCurve::P384;
        else if (curve_name == NID_secp521r1)
            curve = CryptoKeyEC::NamedCurve::P521;
        else {
            EC_KEY_free(ec_key);
            throwException(globalObject, scope, createTypeError(globalObject, "Unsupported EC curve"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        EC_KEY_free(ec_key);
        return KeyObject__createECFromPrivate(globalObject, pkey, curve, CryptoAlgorithmIdentifier::ECDSA);
    } else if (pKeyID == EVP_PKEY_ED25519 || pKeyID == EVP_PKEY_X25519) {
        size_t out_len = 0;
        auto& vm = globalObject->vm();
        if (!EVP_PKEY_get_raw_private_key(pkey, nullptr, &out_len)) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        Vector<uint8_t> out(out_len);
        if (!EVP_PKEY_get_raw_private_key(pkey, out.data(), &out_len) || out_len != out.size()) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        return KeyObject__createOKPFromPrivate(globalObject, out, pKeyID == EVP_PKEY_ED25519 ? CryptoKeyOKP::NamedCurve::Ed25519 : CryptoKeyOKP::NamedCurve::X25519, CryptoAlgorithmIdentifier::Ed25519);
    } else {
        throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key type"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
}

JSC::EncodedJSValue KeyObject__createPublicKey(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{

    auto count = callFrame->argumentCount();
    auto& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 1) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "createPublicKey requires 1 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(0));
    if (!options) {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    JSValue keyJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "key"_s)));
    if (keyJSValue.isUndefinedOrNull() || keyJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "key is required"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    void* data;
    size_t byteLength;
    if (auto* key = jsDynamicCast<JSCryptoKey*>(keyJSValue)) {
        auto& wrapped = key->wrapped();
        auto key_type = wrapped.type();
        if (key_type != CryptoKeyType::Private) {
            JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type, expected private"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto id = wrapped.keyClass();

        switch (id) {
        case CryptoKeyClass::RSA: {
            return KeyObject__createRSAFromPrivate(globalObject, downcast<WebCore::CryptoKeyRSA>(wrapped).platformKey(), wrapped.algorithmIdentifier());
        }
        case CryptoKeyClass::EC: {
            auto& impl = downcast<WebCore::CryptoKeyEC>(wrapped);
            return KeyObject__createECFromPrivate(globalObject, impl.platformKey(), impl.namedCurve(), wrapped.algorithmIdentifier());
        }
        case CryptoKeyClass::OKP: {
            auto& impl = downcast<WebCore::CryptoKeyOKP>(wrapped);
            return KeyObject__createOKPFromPrivate(globalObject, impl.exportKey(), impl.namedCurve(), wrapped.algorithmIdentifier());
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type, expected private"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        }
    }
    if (!keyJSValue.isCell()) {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSValue formatJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "format"_s)));
    if (formatJSValue.isUndefinedOrNull() || formatJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "format is required"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    if (!formatJSValue.isString()) {
        JSC::throwTypeError(globalObject, scope, "format must be a string"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto format = formatJSValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    auto keyJSValueCell = keyJSValue.asCell();
    auto type = keyJSValueCell->type();

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
        JSC::JSArrayBufferView* view = jsCast<JSC::JSArrayBufferView*>(keyJSValueCell);

        data = view->vector();
        byteLength = view->length();
        break;
    }
    case ArrayBufferType: {
        auto* jsBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(keyJSValueCell);
        if (UNLIKELY(!jsBuffer)) {
            auto scope = DECLARE_THROW_SCOPE(vm);
            throwException(globalObject, scope, createTypeError(globalObject, "ERR_INVALID_ARG_TYPE: expected key to be Buffer or array-like object"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        auto* buffer = jsBuffer->impl();
        data = buffer->data();
        byteLength = buffer->byteLength();
        break;
    }
    default: {
        if (auto* keyObj = jsDynamicCast<JSC::JSObject*>(keyJSValue)) {
            if (format != "jwk"_s) {
                JSC::throwTypeError(globalObject, scope, "format should be 'jwk' when key type is 'object'"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            auto jwk = WebCore::convertDictionary<JsonWebKey>(*globalObject, keyJSValue);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
            if (jwk.kty == "OKP"_s) {
                if (jwk.crv == "Ed25519"_s) {
                    auto result = CryptoKeyOKP::importPublicJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(jwk), true, CryptoKeyUsageVerify);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                        return JSValue::encode(JSC::jsUndefined());
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() == CryptoKeyType::Private) {
                        return KeyObject__createOKPFromPrivate(globalObject, impl.get().exportKey(), CryptoKeyOKP::NamedCurve::Ed25519, CryptoAlgorithmIdentifier::Ed25519);
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else if (jwk.crv == "X25519"_s) {
                    auto result = CryptoKeyOKP::importPublicJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, WTFMove(jwk), true, CryptoKeyUsageVerify);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 public key"_s));
                        return JSValue::encode(JSC::jsUndefined());
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() == CryptoKeyType::Private) {
                        return KeyObject__createOKPFromPrivate(globalObject, impl.get().exportKey(), CryptoKeyOKP::NamedCurve::X25519, CryptoAlgorithmIdentifier::Ed25519);
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else {
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported OKP curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
            } else if (jwk.kty == "EC"_s) {
                auto result = CryptoKeyEC::importJwk(CryptoAlgorithmIdentifier::ECDSA, jwk.crv, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                if (impl->type() == CryptoKeyType::Private) {
                    return KeyObject__createECFromPrivate(globalObject, impl.get().platformKey(), impl.get().namedCurve(), CryptoAlgorithmIdentifier::ECDSA);
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (jwk.kty == "RSA"_s) {
                auto result = CryptoKeyRSA::importJwk(CryptoAlgorithmIdentifier::RSA_OAEP, std::nullopt, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid RSA public key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                if (impl->type() == CryptoKeyType::Private) {
                    return KeyObject__createRSAFromPrivate(globalObject, impl.get().platformKey(), CryptoAlgorithmIdentifier::RSA_OAEP);
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
        }
    }
    }

    if (format == "jwk"_s) {
        JSC::throwTypeError(globalObject, scope, "The \"key\" property must be of type object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (UNLIKELY(!data) || UNLIKELY(!byteLength)) {
        throwException(globalObject, scope, createTypeError(globalObject, "ERR_INVALID_ARG_TYPE: expected key to be Buffer or array-like object"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (format == "pem"_s) {
        auto pem = KeyObject__ParsePublicKeyPEM((const char*)data, byteLength);
        if (!pem.key) {
            // maybe is a private pem
            auto bio = BIOPtr(BIO_new_mem_buf(const_cast<char*>((char*)data), byteLength));
            JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
            PrivateKeyPassphrase passphrase = { nullptr, 0 };

            auto hasPassphrase = !passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty();

            if (hasPassphrase) {
                if (passphraseJSValue.isString()) {
                    auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, encodedJSValue());
                    if (!passphrase_wtfstr.isNull()) {
                        if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                            if (pass.has_value()) {
                                auto value = pass.value();
                                passphrase.passphrase = const_cast<char*>(value.data());
                                passphrase.passphrase_len = value.length();
                            }
                        }
                    }
                } else if (auto* passphraseBuffer = jsDynamicCast<JSUint8Array*>(passphraseJSValue)) {
                    passphrase.passphrase = (char*)passphraseBuffer->vector();
                    passphrase.passphrase_len = passphraseBuffer->byteLength();
                } else {
                    JSC::throwTypeError(globalObject, scope, "passphrase must be a Buffer or String"_s);
                    return JSC::JSValue::encode(JSC::JSValue {});
                }
            }

            auto pkey = EvpPKeyPtr(PEM_read_bio_PrivateKey(bio.get(), nullptr, PasswordCallback, &passphrase));
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid PEM data"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            return KeyObject__createPublicFromPrivate(globalObject, pkey.get());
        }
        auto pkey = EvpPKeyPtr(pem.key);
        auto pKeyID = EVP_PKEY_id(pem.key);
        if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(pkey), true, CryptoKeyUsageEncrypt);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_ED25519) {
            auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, Vector<uint8_t>((uint8_t*)pem.der_data, (size_t)pem.der_len), true, CryptoKeyUsageVerify);
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_X25519) {
            auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, Vector<uint8_t>((uint8_t*)pem.der_data, (size_t)pem.der_len), true, CryptoKeyUsageVerify);
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_EC) {
            EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
            if (UNLIKELY(ec_key == nullptr)) {
                if (pem.der_data) {
                    OPENSSL_clear_free(pem.der_data, pem.der_len);
                }
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
            // Get the curve name
            int curve_name = EC_GROUP_get_curve_name(ec_group);
            if (curve_name == NID_undef) {
                if (pem.der_data) {
                    OPENSSL_clear_free(pem.der_data, pem.der_len);
                }
                EC_KEY_free(ec_key);
                throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            CryptoKeyEC::NamedCurve curve;
            if (curve_name == NID_X9_62_prime256v1)
                curve = CryptoKeyEC::NamedCurve::P256;
            else if (curve_name == NID_secp384r1)
                curve = CryptoKeyEC::NamedCurve::P384;
            else if (curve_name == NID_secp521r1)
                curve = CryptoKeyEC::NamedCurve::P521;
            else {
                if (pem.der_data) {
                    OPENSSL_clear_free(pem.der_data, pem.der_len);
                }
                EC_KEY_free(ec_key);
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported EC curve"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDH, curve, Vector<uint8_t>((uint8_t*)pem.der_data, (size_t)pem.der_len), true, CryptoKeyUsageVerify);
            if (UNLIKELY(result == nullptr)) {
                result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDSA, curve, Vector<uint8_t>((uint8_t*)pem.der_data, (size_t)pem.der_len), true, CryptoKeyUsageVerify);
            }
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else {
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            throwException(globalObject, scope, createTypeError(globalObject, "Unsupported public key"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
    }
    if (format == "der"_s) {
        JSValue typeJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "type"_s)));
        WTF::String type = "spki"_s;
        if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
            if (!typeJSValue.isString()) {
                JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            type = typeJSValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
        }

        if (type == "pkcs1"_s) {
            // must be RSA
            const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
            auto pkey = EvpPKeyPtr(d2i_PublicKey(EVP_PKEY_RSA, nullptr, &p, byteLength));
            if (!pkey) {
                // maybe is a private RSA key
                const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
                pkey = EvpPKeyPtr(d2i_PrivateKey(EVP_PKEY_RSA, nullptr, &p, byteLength));
                if (!pkey) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid PKCS#1"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }

                auto pKeyID = EVP_PKEY_id(pkey.get());
                return KeyObject__createRSAFromPrivate(globalObject, pkey.get(), pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5 : CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5);
            }

            auto pKeyID = EVP_PKEY_id(pkey.get());
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5 : CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(pkey), true, CryptoKeyUsageEncrypt);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (type == "spki"_s) {
            // We use d2i_PUBKEY() to import a public key.
            const uint8_t* ptr = reinterpret_cast<const uint8_t*>(data);
            auto pkey = EvpPKeyPtr(d2i_PUBKEY(nullptr, &ptr, byteLength));
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
            auto pKeyID = EVP_PKEY_id(pkey.get());

            if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
                auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(pkey), true, CryptoKeyUsageEncrypt);
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_ED25519) {
                auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageVerify);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_X25519) {
                auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageVerify);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_EC) {
                EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
                if (UNLIKELY(ec_key == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
                // Get the curve name
                int curve_name = EC_GROUP_get_curve_name(ec_group);
                if (curve_name == NID_undef) {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                CryptoKeyEC::NamedCurve curve;
                if (curve_name == NID_X9_62_prime256v1)
                    curve = CryptoKeyEC::NamedCurve::P256;
                else if (curve_name == NID_secp384r1)
                    curve = CryptoKeyEC::NamedCurve::P384;
                else if (curve_name == NID_secp521r1)
                    curve = CryptoKeyEC::NamedCurve::P521;
                else {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported EC curve"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto alg = CryptoAlgorithmIdentifier::ECDH;
                auto result = CryptoKeyEC::platformImportSpki(alg, curve, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageVerify);
                if (UNLIKELY(result == nullptr)) {
                    alg = CryptoAlgorithmIdentifier::ECDSA;
                    result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDSA, curve, Vector<uint8_t>((uint8_t*)data, byteLength), true, CryptoKeyUsageVerify);
                }
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                    return JSValue::encode(JSC::jsUndefined());
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported public key"_s));
                return JSValue::encode(JSC::jsUndefined());
            }
        }

        JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
        return JSValue::encode(JSC::jsUndefined());
    }
    JSC::throwTypeError(globalObject, scope, "format should be 'pem' or 'der'"_s);
    return JSValue::encode(JSC::jsUndefined());
}

JSC::EncodedJSValue KeyObject__createSecretKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{

    JSValue bufferArg = callFrame->uncheckedArgument(0);
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* structure = globalObject->JSCryptoKeyStructure();

    if (!bufferArg.isCell()) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_INVALID_ARG_TYPE: expected Buffer or array-like object"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto bufferArgCell = bufferArg.asCell();
    auto type = bufferArgCell->type();

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
        JSC::JSArrayBufferView* view = jsCast<JSC::JSArrayBufferView*>(bufferArgCell);

        void* data = view->vector();
        size_t byteLength = view->length();
        if (UNLIKELY(!data)) {
            break;
        }
        auto impl = CryptoKeyHMAC::generateFromBytes(data, byteLength, CryptoAlgorithmIdentifier::HMAC, true, CryptoKeyUsageSign | CryptoKeyUsageVerify).releaseNonNull();
        return JSC::JSValue::encode(JSCryptoKey::create(structure, globalObject, WTFMove(impl)));
    }
    case ArrayBufferType: {
        auto* jsBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(bufferArgCell);
        if (UNLIKELY(!jsBuffer)) {
            break;
        }
        auto* buffer = jsBuffer->impl();
        void* data = buffer->data();
        size_t byteLength = buffer->byteLength();
        if (UNLIKELY(!data)) {
            break;
        }
        Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        auto impl = CryptoKeyHMAC::generateFromBytes(data, byteLength, CryptoAlgorithmIdentifier::HMAC, true, CryptoKeyUsageSign | CryptoKeyUsageVerify).releaseNonNull();
        return JSC::JSValue::encode(JSCryptoKey::create(structure, globalObject, WTFMove(impl)));
    }
    default:
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_INVALID_ARG_TYPE: expected Buffer or array-like object"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
}

JSC::EncodedJSValue KeyObject__Exports(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{

    auto count = callFrame->argumentCount();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 2) {
        JSC::throwTypeError(globalObject, scope, "exports requires 2 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0));
    if (!key) {
        // No JSCryptoKey instance
        JSC::throwTypeError(globalObject, scope, "expected CryptoKey as first argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto& wrapped = key->wrapped();
    auto key_type = wrapped.type();
    auto id = wrapped.keyClass();
    if (auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1))) {
        JSValue formatJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "format"_s)));
        JSValue typeJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "type"_s)));
        JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
        auto hasPassphrase = !passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty();
        if (formatJSValue.isUndefinedOrNull() || formatJSValue.isEmpty()) {
            JSC::throwTypeError(globalObject, scope, "format is expected to be a string"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        auto string = formatJSValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
        if (string == "jwk"_s && hasPassphrase) {
            JSC::throwTypeError(globalObject, scope, "encryption is not supported for jwk format"_s);
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
                return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue, true));
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
                return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue, true));
            }
            break;
        }
        case CryptoKeyClass::RSA: {
            const auto& rsa = downcast<WebCore::CryptoKeyRSA>(wrapped);
            if (string == "jwk"_s) {
                const JsonWebKey& jwkValue = rsa.exportJwk();
                Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue, true));
            } else {
                WTF::String type = "pkcs1"_s;
                if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
                    if (!typeJSValue.isString()) {
                        JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                        return JSC::JSValue::encode(JSC::JSValue {});
                    }
                    type = typeJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, encodedJSValue());
                }

                auto* bio = BIO_new(BIO_s_mem());
                auto* rsaKey = rsa.platformKey();
                auto* rsa_ptr = EVP_PKEY_get0_RSA(rsaKey);

                if (key_type == CryptoKeyType::Public) {
                    if (string == "pem"_s) {
                        if (type == "pkcs1"_s) {
                            if (PEM_write_bio_RSAPublicKey(bio, rsa_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else if (type == "spki"_s) {
                            if (PEM_write_bio_PUBKEY(bio, rsaKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }

                    } else if (string == "der"_s) {
                        if (type == "pkcs1"_s) {
                            if (i2d_RSAPublicKey_bio(bio, rsa_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else if (type == "spki"_s) {
                            if (i2d_PUBKEY_bio(bio, rsaKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        return JSC::JSValue::encode(JSC::JSValue {});
                    }
                } else {
                    JSValue cipherJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                    const EVP_CIPHER* cipher = nullptr;
                    if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty() && cipherJSValue.isString()) {
                        auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, encodedJSValue());
                        if (!cipher_wtfstr.isNull()) {
                            auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                            if (!cipherOrError.has_value()) {
                                JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            } else {
                                auto value = cipherOrError.value();
                                auto cipher_str = value.data();
                                if (cipher_str != nullptr) {
                                    cipher = EVP_get_cipherbyname(cipher_str);
                                }
                            }
                        }
                    }
                    void* passphrase = nullptr;
                    size_t passphrase_len = 0;
                    if (hasPassphrase) {
                        if (!cipher) {
                            JSC::throwTypeError(globalObject, scope, "cipher is required when passphrase is specified"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                        if (passphraseJSValue.isString()) {
                            auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                            RETURN_IF_EXCEPTION(scope, encodedJSValue());
                            if (!passphrase_wtfstr.isNull()) {
                                if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                                    if (pass.has_value()) {
                                        auto value = pass.value();
                                        passphrase = const_cast<char*>(value.data());
                                        passphrase_len = value.length();
                                    }
                                }
                            }
                        } else if (auto* passphraseBuffer = jsDynamicCast<JSUint8Array*>(passphraseJSValue)) {
                            passphrase = passphraseBuffer->vector();
                            passphrase_len = passphraseBuffer->byteLength();
                        } else {
                            JSC::throwTypeError(globalObject, scope, "passphrase must be a Buffer or String"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    }

                    if (string == "pem"_s) {
                        if (type == "pkcs1"_s) {
                            if (PEM_write_bio_RSAPrivateKey(bio, rsa_ptr, cipher, (unsigned char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else if (type == "pkcs8"_s) {
                            if (PEM_write_bio_PKCS8PrivateKey(bio, rsaKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else if (string == "der"_s) {
                        if (type == "pkcs1"_s) {
                            if (i2d_RSAPrivateKey_bio(bio, rsa_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else if (type == "pkcs8"_s) {
                            if (i2d_PKCS8PrivateKey_bio(bio, rsaKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else {
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
                    WebCore::propagateException(*globalObject, scope, result.releaseException());
                    return JSC::JSValue::encode(JSC::JSValue {});
                }
                const JsonWebKey& jwkValue = result.releaseReturnValue();
                Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue, true));
            } else {
                WTF::String type = "spki"_s;
                if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
                    if (!typeJSValue.isString()) {
                        JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                        return JSC::JSValue::encode(JSC::JSValue {});
                    }
                    type = typeJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, encodedJSValue());
                }

                auto* bio = BIO_new(BIO_s_mem());
                auto* ecKey = ec.platformKey();
                auto* ec_ptr = EVP_PKEY_get1_EC_KEY(ecKey);

                if (key_type == CryptoKeyType::Public) {
                    if (string == "pem"_s) {
                        if (type == "spki"_s) {
                            if (PEM_write_bio_PUBKEY(bio, ecKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }

                    } else if (string == "der"_s) {
                        if (type == "spki"_s) {
                            if (i2d_PUBKEY_bio(bio, ecKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        return JSC::JSValue::encode(JSC::JSValue {});
                    }
                } else {
                    JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
                    JSValue cipherJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                    const EVP_CIPHER* cipher = nullptr;
                    if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty()) {
                        auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, encodedJSValue());
                        if (!cipher_wtfstr.isNull()) {
                            auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                            if (!cipherOrError.has_value()) {
                                JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            } else {
                                auto value = cipherOrError.value();
                                auto cipher_str = value.data();
                                if (cipher_str != nullptr) {
                                    cipher = EVP_get_cipherbyname(cipher_str);
                                }
                            }
                        }
                    }
                    void* passphrase = nullptr;
                    size_t passphrase_len = 0;
                    auto hasPassphrase = !passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty();

                    if (hasPassphrase) {
                        if (!cipher) {
                            JSC::throwTypeError(globalObject, scope, "cipher is required when passphrase is specified"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                        if (passphraseJSValue.isString()) {
                            auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                            RETURN_IF_EXCEPTION(scope, encodedJSValue());
                            if (!passphrase_wtfstr.isNull()) {
                                if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                                    if (pass.has_value()) {
                                        auto value = pass.value();
                                        passphrase = const_cast<char*>(value.data());
                                        passphrase_len = value.length();
                                    }
                                }
                            }
                        } else if (auto* passphraseBuffer = jsDynamicCast<JSUint8Array*>(passphraseJSValue)) {
                            passphrase = passphraseBuffer->vector();
                            passphrase_len = passphraseBuffer->byteLength();
                        } else {
                            JSC::throwTypeError(globalObject, scope, "passphrase must be a Buffer or String"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    }

                    if (string == "pem"_s) {
                        if (type == "sec1"_s) {
                            if (PEM_write_bio_ECPrivateKey(bio, ec_ptr, cipher, (unsigned char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else if (type == "pkcs8"_s) {
                            if (PEM_write_bio_PKCS8PrivateKey(bio, ecKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'sec1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else if (string == "der"_s) {
                        if (type == "sec1"_s) {
                            if (i2d_ECPrivateKey_bio(bio, ec_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else if (type == "pkcs8"_s) {
                            if (i2d_PKCS8PrivateKey_bio(bio, ecKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'sec1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else {
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
                    WebCore::propagateException(*globalObject, scope, result.releaseException());
                    return JSC::JSValue::encode(JSC::JSValue {});
                }
                const JsonWebKey& jwkValue = result.releaseReturnValue();
                Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue, true));
            } else {
                WTF::String type = "pkcs8"_s;
                if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
                    if (!typeJSValue.isString()) {
                        JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                        return JSC::JSValue::encode(JSC::JSValue {});
                    }
                    type = typeJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, encodedJSValue());
                }

                auto keyData = okpKey.exportKey();
                auto* bio = BIO_new(BIO_s_mem());

                EVP_PKEY* evpKey;
                // TODO: CHECK THIS WHEN X488 AND ED448 ARE ADDED
                if (okpKey.type() == CryptoKeyType::Private) {
                    evpKey = EVP_PKEY_new_raw_private_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
                    JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
                    JSValue cipherJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                    const EVP_CIPHER* cipher = nullptr;
                    if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty() && cipherJSValue.isString()) {
                        auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, encodedJSValue());
                        if (!cipher_wtfstr.isNull()) {
                            auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                            if (!cipherOrError.has_value()) {
                                JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            } else {
                                auto value = cipherOrError.value();
                                auto cipher_str = value.data();
                                if (cipher_str != nullptr) {
                                    cipher = EVP_get_cipherbyname(cipher_str);
                                }
                            }
                        }
                    }
                    void* passphrase = nullptr;
                    size_t passphrase_len = 0;
                    auto hasPassphrase = !passphraseJSValue.isUndefinedOrNull() && !passphraseJSValue.isEmpty();

                    if (hasPassphrase) {
                        if (!cipher) {
                            JSC::throwTypeError(globalObject, scope, "cipher is required when passphrase is specified"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                        if (passphraseJSValue.isString()) {
                            auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
                            RETURN_IF_EXCEPTION(scope, encodedJSValue());
                            if (!passphrase_wtfstr.isNull()) {
                                if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                                    if (pass.has_value()) {
                                        auto value = pass.value();
                                        passphrase = const_cast<char*>(value.data());
                                        passphrase_len = value.length();
                                    }
                                }
                            }
                        } else if (auto* passphraseBuffer = jsDynamicCast<JSUint8Array*>(passphraseJSValue)) {
                            passphrase = passphraseBuffer->vector();
                            passphrase_len = passphraseBuffer->byteLength();
                        } else {
                            JSC::throwTypeError(globalObject, scope, "passphrase must be a Buffer or String"_s);
                            BIO_free(bio);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    }

                    if (string == "pem"_s) {
                        if (type == "pkcs8"_s) {
                            if (PEM_write_bio_PKCS8PrivateKey(bio, evpKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs8'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else if (string == "der"_s) {
                        if (type == "pkcs8"_s) {
                            if (i2d_PKCS8PrivateKey_bio(bio, evpKey, cipher, (char*)passphrase, passphrase_len, nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs8'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else {
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
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }

                    } else if (string == "der"_s) {
                        if (type == "spki"_s) {
                            if (i2d_PUBKEY_bio(bio, evpKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return JSC::JSValue::encode(JSC::JSValue {});
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return JSC::JSValue::encode(JSC::JSValue {});
                        }
                    } else {
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

            JSC::throwTypeError(globalObject, scope, "format is expected to be 'buffer'"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "Invalid Operation"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        }
        JSC::throwTypeError(globalObject, scope, "format is expected to be 'buffer' or 'jwk'"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    } else {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
}

static char* bignum_to_string(const BIGNUM* bn)
{
    char *tmp, *ret;
    size_t len;

    // Display large numbers in hex and small numbers in decimal. Converting to
    // decimal takes quadratic time and is no more useful than hex for large
    // numbers.
    if (BN_num_bits(bn) < 32) {
        return BN_bn2dec(bn);
    }

    tmp = BN_bn2hex(bn);
    if (tmp == NULL) {
        return NULL;
    }

    len = strlen(tmp) + 3;
    ret = (char*)OPENSSL_malloc(len);
    if (ret == NULL) {
        OPENSSL_free(tmp);
        return NULL;
    }

    // Prepend "0x", but place it after the "-" if negative.
    if (tmp[0] == '-') {
        OPENSSL_strlcpy(ret, "-0x", len);
        OPENSSL_strlcat(ret, tmp + 1, len);
    } else {
        OPENSSL_strlcpy(ret, "0x", len);
        OPENSSL_strlcat(ret, tmp, len);
    }
    OPENSSL_free(tmp);
    return ret;
}

JSC::EncodedJSValue KeyObject_AsymmetricKeyDetails(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{

    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        auto id = key->wrapped().algorithmIdentifier();
        auto& vm = lexicalGlobalObject->vm();
        switch (id) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
        case CryptoAlgorithmIdentifier::RSA_PSS: {
            auto* obj = JSC::constructEmptyObject(lexicalGlobalObject);

            auto& wrapped = key->wrapped();
            const auto& rsa = downcast<WebCore::CryptoKeyRSA>(wrapped);
            auto* platformKey = rsa.platformKey();
            const BIGNUM* e; // Public Exponent
            const BIGNUM* n; // Modulus
            const RSA* rsa_key = EVP_PKEY_get0_RSA(platformKey);
            if (rsa_key == nullptr) {
                return JSValue::encode(JSC::jsUndefined());
            }

            RSA_get0_key(rsa_key, &n, &e, nullptr);

            auto modulus_length = BN_num_bits(n);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "modulusLength"_s)), jsNumber(modulus_length), 0);

            auto str = bignum_to_string(e);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "publicExponent"_s)), JSC::JSBigInt::stringToBigInt(lexicalGlobalObject, StringView::fromLatin1(str)), 0);
            OPENSSL_free(str);

            if (id == CryptoAlgorithmIdentifier::RSA_PSS) {
                // Due to the way ASN.1 encoding works, default values are omitted when
                // encoding the data structure. However, there are also RSA-PSS keys for
                // which no parameters are set. In that case, the ASN.1 RSASSA-PSS-params
                // sequence will be missing entirely and RSA_get0_pss_params will return
                // nullptr. If parameters are present but all parameters are set to their
                // default values, an empty sequence will be stored in the ASN.1 structure.
                // In that case, RSA_get0_pss_params does not return nullptr but all fields
                // of the returned RSA_PSS_PARAMS will be set to nullptr.

                auto* params = RSA_get0_pss_params(rsa_key);
                if (params != nullptr) {
                    int hash_nid = NID_sha1;
                    int mgf_nid = NID_mgf1;
                    int mgf1_hash_nid = NID_sha1;
                    int64_t salt_length = 20;

                    if (params->hashAlgorithm != nullptr) {
                        hash_nid = OBJ_obj2nid(params->hashAlgorithm->algorithm);
                    }
                    auto* hash_srt = OBJ_nid2ln(hash_nid);
                    obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "hashAlgorithm"_s)), Bun::toJS(lexicalGlobalObject, Bun::toString(hash_srt, strlen(hash_srt))), 0);
                    if (params->maskGenAlgorithm != nullptr) {
                        mgf_nid = OBJ_obj2nid(params->maskGenAlgorithm->algorithm);
                        if (mgf_nid == NID_mgf1) {
                            mgf1_hash_nid = OBJ_obj2nid(params->maskHash->algorithm);
                        }
                    }

                    // If, for some reason, the MGF is not MGF1, then the MGF1 hash function
                    // is intentionally not added to the object.
                    if (mgf_nid == NID_mgf1) {
                        auto* mgf1_hash_srt = OBJ_nid2ln(mgf1_hash_nid);
                        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "mgf1HashAlgorithm"_s)), Bun::toJS(lexicalGlobalObject, Bun::toString(mgf1_hash_srt, strlen(mgf1_hash_srt))), 0);
                    }

                    if (params->saltLength != nullptr) {
                        if (ASN1_INTEGER_get_int64(&salt_length, params->saltLength) != 1) {
                            auto scope = DECLARE_THROW_SCOPE(vm);
                            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Failed to get saltLenght"_s));
                            return JSValue::encode(JSC::jsUndefined());
                        }
                    }
                    obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "saltLength"_s)), jsNumber(salt_length), 0);
                }
            }
            return JSC::JSValue::encode(obj);
        }
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH: {
            auto* obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 1);

            auto& wrapped = key->wrapped();
            const auto& ec = downcast<WebCore::CryptoKeyEC>(wrapped);
            static const NeverDestroyed<String> values[] = {
                MAKE_STATIC_STRING_IMPL("prime256v1"),
                MAKE_STATIC_STRING_IMPL("secp384r1"),
                MAKE_STATIC_STRING_IMPL("secp521r1"),
            };

            WTF::String named_curve;
            switch (ec.namedCurve()) {
            case CryptoKeyEC::NamedCurve::P256:
                named_curve = values[0];
                break;
            case CryptoKeyEC::NamedCurve::P384:
                named_curve = values[1];
                break;
            case CryptoKeyEC::NamedCurve::P521:
                named_curve = values[2];
                break;
            default:
                ASSERT_NOT_REACHED();
                named_curve = WTF::emptyString();
            }

            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "namedCurve"_s)), JSC::jsString(vm, named_curve), 0);
            return JSC::JSValue::encode(obj);
        }
        case CryptoAlgorithmIdentifier::Ed25519: {
            auto* obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 1);
            auto& wrapped = key->wrapped();
            const auto& okp = downcast<WebCore::CryptoKeyOKP>(wrapped);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "namedCurve"_s)), JSC::jsString(vm, okp.namedCurveString()), 0);
            return JSC::JSValue::encode(obj);
        }
        default:
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC::EncodedJSValue KeyObject__generateKeyPairSync(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto count = callFrame->argumentCount();
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 1) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "generateKeyPairSync requires 1 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto type = callFrame->argument(0);
    if (type.isUndefinedOrNull() || type.isEmpty() || !type.isString()) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "type is expected to be a string"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto type_str = type.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();
    // TODO: rsa-pss
    if (type_str == "rsa"_s) {
        if (count == 1) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.modulusLength are required for rsa"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1));
        if (options == nullptr) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options is expected to be a object"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto modulusLengthJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "modulusLength"_s)));
        if (!modulusLengthJS.isNumber()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.modulusLength is expected to be a number"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto publicExponentJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "publicExponent"_s)));
        uint32_t publicExponent = 0x10001;
        if (publicExponentJS.isNumber()) {
            publicExponent = publicExponentJS.toUInt32(lexicalGlobalObject);
        } else if (!publicExponentJS.isUndefinedOrNull() && !publicExponentJS.isEmpty()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.publicExponent is expected to be a number"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        uint8_t publicExponentArray[4];
        publicExponentArray[0] = (uint8_t)(publicExponent >> 24);
        publicExponentArray[1] = (uint8_t)(publicExponent >> 16);
        publicExponentArray[2] = (uint8_t)(publicExponent >> 8);
        publicExponentArray[3] = (uint8_t)publicExponent;           
        
        int modulusLength = modulusLengthJS.toUInt32(lexicalGlobalObject);
        auto returnValue = JSC::JSValue {};
        auto keyPairCallback = [&](CryptoKeyPair&& pair) {
            pair.publicKey->setUsagesBitmap(pair.publicKey->usagesBitmap() & CryptoKeyUsageVerify);
            pair.privateKey->setUsagesBitmap(pair.privateKey->usagesBitmap() & CryptoKeyUsageSign);

            auto obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 2);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "publicKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.publicKey.releaseNonNull()), 0);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "privateKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.privateKey.releaseNonNull()), 0);
            returnValue = obj;
        };
        auto failureCallback = [&]() {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Failed to generate key pair"_s));
        };
        // this is actually sync
        CryptoKeyRSA::generatePair(CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, modulusLength, Vector<uint8_t>((uint8_t*)&publicExponentArray, 4), true, CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt, WTFMove(keyPairCallback), WTFMove(failureCallback), zigGlobalObject->scriptExecutionContext());
        return JSValue::encode(returnValue);
    } else if (type_str == "ec"_s) {
        if (count == 1) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.namedCurve is required for ec"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1));
        if (options == nullptr) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options is expected to be a object"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto namedCurveJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "namedCurve"_s)));
        if (namedCurveJS.isUndefinedOrNull() || namedCurveJS.isEmpty() || !namedCurveJS.isString()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "namedCurve is expected to be a string"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto namedCurve = namedCurveJS.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
        if(namedCurve == "P-384"_s || namedCurve == "p384"_s || namedCurve == "secp384r1"_s) {
            namedCurve = "P-384"_s;
        } else if(namedCurve == "P-256"_s || namedCurve == "p256"_s || namedCurve == "prime256v1"_s) {
            namedCurve = "P-256"_s;
        } else if(namedCurve == "P-521"_s || namedCurve == "p521"_s || namedCurve == "secp521r1"_s) {
            namedCurve = "P-521"_s;
        }else {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "curve not supported"_s));
            return JSValue::encode(JSC::jsUndefined());    
        }
        
        auto result = CryptoKeyEC::generatePair(CryptoAlgorithmIdentifier::ECDSA, namedCurve, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (result.hasException()) {
            WebCore::propagateException(*lexicalGlobalObject, scope, result.releaseException());
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto pair = result.releaseReturnValue();
        auto obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 2);
        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "publicKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.publicKey.releaseNonNull()), 0);
        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "privateKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.privateKey.releaseNonNull()), 0);
        return JSValue::encode(obj);
    } else if (type_str == "ed25519"_s) {
        auto result = CryptoKeyOKP::generatePair(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (result.hasException()) {
            WebCore::propagateException(*lexicalGlobalObject, scope, result.releaseException());
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto pair = result.releaseReturnValue();
        auto obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 2);
        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "publicKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.publicKey.releaseNonNull()), 0);
        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "privateKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.privateKey.releaseNonNull()), 0);
        return JSValue::encode(obj);
    } else if (type_str == "x25519"_s) {
        auto result = CryptoKeyOKP::generatePair(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (result.hasException()) {
            WebCore::propagateException(*lexicalGlobalObject, scope, result.releaseException());
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto pair = result.releaseReturnValue();
        auto obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 2);
        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "publicKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.publicKey.releaseNonNull()), 0);
        obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "privateKey"_s)), JSCryptoKey::create(structure, zigGlobalObject, pair.privateKey.releaseNonNull()), 0);
        return JSValue::encode(obj);
    } else {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "algorithm should be 'rsa', 'ec', 'x25519' or 'ed25519'"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    return JSValue::encode(JSC::jsUndefined());
}
JSC::EncodedJSValue KeyObject__generateKeySync(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto count = callFrame->argumentCount();
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (count < 2) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "generateKeySync requires 2 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto type = callFrame->argument(0);
    if (type.isUndefinedOrNull() || type.isEmpty() || !type.isString()) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "type is expected to be a string"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto type_str = type.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    if (type_str == "hmac"_s) {
        Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        auto* structure = zigGlobalObject->JSCryptoKeyStructure();
        size_t lengthBits = 0;
        auto length = callFrame->argument(1);
        if (!length.isNumber()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "length is expected to be a number"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        lengthBits = length.toUInt32(lexicalGlobalObject);
        auto result = CryptoKeyHMAC::generate(lengthBits, WebCore::CryptoAlgorithmIdentifier::HMAC, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (UNLIKELY(result == nullptr)) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Invalid length"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(result.releaseNonNull())));
    } else if (type_str == "aes"_s) {
        Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        auto* structure = zigGlobalObject->JSCryptoKeyStructure();
        size_t lengthBits = 0;
        if (count > 1) {
            auto length = callFrame->argument(1);
            if (!length.isNumber()) {
                JSC::throwTypeError(lexicalGlobalObject, scope, "length is expected to be a number"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            lengthBits = length.toUInt32(lexicalGlobalObject);
        }

        auto result = CryptoKeyAES::generate(WebCore::CryptoAlgorithmIdentifier::AES_CBC, lengthBits, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (UNLIKELY(result == nullptr)) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Invalid length"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(result.releaseNonNull())));
    } else {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "algorithm should be 'aes' or 'hmac'"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
}

JSC::EncodedJSValue KeyObject__AsymmetricKeyType(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    static const NeverDestroyed<String> values[] = {
        MAKE_STATIC_STRING_IMPL("rsa"),
        MAKE_STATIC_STRING_IMPL("rsa-pss"),
        MAKE_STATIC_STRING_IMPL("ec"),
        MAKE_STATIC_STRING_IMPL("x25519"),
        MAKE_STATIC_STRING_IMPL("ed25519"),
    };

    // TODO: Look into DSA and DH
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
        case CryptoAlgorithmIdentifier::ECDH:
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), values[2]));
        case CryptoAlgorithmIdentifier::Ed25519: {
            const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(key->wrapped());
            // TODO: CHECK THIS WHEN X488 AND ED448 ARE ADDED
            return JSC::JSValue::encode(JSC::jsStringWithCache(lexicalGlobalObject->vm(), String(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? values[3] : values[4])));
        }
        default:
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

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

JSC::EncodedJSValue KeyObject__Equals(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
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

JSC::EncodedJSValue KeyObject__SymmetricKeySize(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
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