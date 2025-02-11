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

#include "root.h"
#include "ErrorCode.h"
#include "BunCommonStrings.h"
#include "KeyObject.h"
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
using namespace JSC;
using namespace Bun;
using JSGlobalObject = JSC::JSGlobalObject;
using Exception = JSC::Exception;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;

JSC_DECLARE_HOST_FUNCTION(KeyObject__AsymmetricKeyType);
JSC_DECLARE_HOST_FUNCTION(KeyObject_AsymmetricKeyDetails);
JSC_DECLARE_HOST_FUNCTION(KeyObject__SymmetricKeySize);
JSC_DECLARE_HOST_FUNCTION(KeyObject__Equals);
JSC_DECLARE_HOST_FUNCTION(KeyObject__Exports);
JSC_DECLARE_HOST_FUNCTION(KeyObject__createSecretKey);
JSC_DECLARE_HOST_FUNCTION(KeyObject__createPublicKey);
JSC_DECLARE_HOST_FUNCTION(KeyObject__createPrivateKey);
JSC_DECLARE_HOST_FUNCTION(KeyObject__generateKeySync);
JSC_DECLARE_HOST_FUNCTION(KeyObject__generateKeyPairSync);
JSC_DECLARE_HOST_FUNCTION(KeyObject__Sign);
JSC_DECLARE_HOST_FUNCTION(KeyObject__Verify);
JSC_DECLARE_HOST_FUNCTION(KeyObject__publicEncrypt);
JSC_DECLARE_HOST_FUNCTION(KeyObject__privateDecrypt);

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
// TODO: @cirospaciari - is this supposed to be unused?
// static bool KeyObject__IsRSAPrivateKey(const unsigned char* data, size_t size)
// {
//     // Both RSAPrivateKey and RSAPublicKey structures start with a SEQUENCE.
//     size_t offset, len;
//     if (!KeyObject__IsASN1Sequence(data, size, &offset, &len))
//         return false;

//     // An RSAPrivateKey sequence always starts with a single-byte integer whose
//     // value is either 0 or 1, whereas an RSAPublicKey starts with the modulus
//     // (which is the product of two primes and therefore at least 4), so we can
//     // decide the type of the structure based on the first three bytes of the
//     // sequence.
//     return len >= 3 && data[offset] == 2 && data[offset + 1] == 1 && !(data[offset + 2] & 0xfe);
// }

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

struct AsymmetricKeyValueWithDER {
    EVP_PKEY* key;
    unsigned char* der_data;
    long der_len;
};

class KeyPassphrase {
public:
    enum class Tag {
        None = 0,
        String = 1,
        ArrayBuffer = 2,
    };

private:
    WTF::CString m_passphraseString;
    JSC::JSUint8Array* m_passphraseArray = nullptr;
    Tag tag = Tag::None;

public:
    bool hasPassphrase()
    {
        return tag != Tag::None;
    }

    char* data()
    {
        switch (tag) {
        case Tag::ArrayBuffer: {
            return reinterpret_cast<char*>(this->m_passphraseArray->vector());
        }

        case Tag::String: {
            return const_cast<char*>(this->m_passphraseString.data());
        }

        default: {
            return nullptr;
        }
        }

        return nullptr;
    }

    size_t length()
    {
        switch (tag) {
        case Tag::ArrayBuffer: {
            return this->m_passphraseArray->length();
        }
        case Tag::String: {
            return this->m_passphraseString.length();
        }
        default: {
            return 0;
        }
        }

        return 0;
    }

    KeyPassphrase(JSValue passphraseJSValue, JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
    {
        this->tag = Tag::None;
        this->m_passphraseString = WTF::CString();
        this->m_passphraseArray = nullptr;

        if (passphraseJSValue.isUndefinedOrNull() || passphraseJSValue.isEmpty()) {
            return;
        }
        if (passphraseJSValue.isString()) {
            auto passphrase_wtfstr = passphraseJSValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (!passphrase_wtfstr.isNull()) {
                if (auto pass = passphrase_wtfstr.tryGetUTF8()) {
                    if (pass.has_value()) {
                        this->tag = Tag::String;
                        this->m_passphraseString = WTFMove(pass.value());
                    }
                }
            }
        } else if (auto* array = jsDynamicCast<JSUint8Array*>(passphraseJSValue)) {
            if (UNLIKELY(array->isDetached())) {
                JSC::throwTypeError(globalObject, scope, "passphrase must not be detached"_s);
                return;
            }

            this->m_passphraseArray = array;
            this->tag = Tag::ArrayBuffer;
        } else {
            JSC::throwTypeError(globalObject, scope, "passphrase must be a Buffer or String"_s);
        }
    }

    ~KeyPassphrase()
    {
    }

    WTF_MAKE_NONCOPYABLE(KeyPassphrase);
    WTF_FORBID_HEAP_ALLOCATION(KeyPassphrase);
};

int PasswordCallback(char* buf, int size, int rwflag, void* u)
{
    auto result = static_cast<KeyPassphrase*>(u);
    if (result != nullptr && result->hasPassphrase() && size > 0) {
        auto data = result->data();
        if (data != nullptr) {
            size_t buflen = static_cast<size_t>(size);
            size_t len = result->length();
            if (buflen < len)
                return -1;
            memcpy(buf, result->data(), len);
            return len;
        }
    }

    return -1;
}

AsymmetricKeyValueWithDER KeyObject__ParsePublicKeyPEM(const char* key_pem,
    size_t key_pem_len)
{
    auto bp = BIOPtr(BIO_new_mem_buf(const_cast<char*>(key_pem), key_pem_len));
    auto result = AsymmetricKeyValueWithDER { .key = nullptr, .der_data = nullptr, .der_len = 0 };

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

JSC_DEFINE_HOST_FUNCTION(KeyObject__createPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 1) {
        JSC::throwTypeError(globalObject, scope, "createPrivateKey requires 1 arguments"_s);
        return {};
    }

    auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(0));
    if (!options) {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return {};
    }

    JSValue keyJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "key"_s)));
    if (keyJSValue.isUndefinedOrNull() || keyJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "key is required"_s);
        return {};
    }
    if (!keyJSValue.isCell()) {
        JSC::throwTypeError(globalObject, scope, "key must be a Buffer, Array-like or object"_s);
        return {};
    }

    JSValue formatJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "format"_s)));
    if (formatJSValue.isUndefinedOrNull() || formatJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "format is required"_s);
        return {};
    }

    if (!formatJSValue.isString()) {
        JSC::throwTypeError(globalObject, scope, "format must be a string"_s);
        return {};
    }
    auto format = formatJSValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

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
    case Float16ArrayType:
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
            return {};
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
                return {};
            }
            auto jwk = WebCore::convertDictionary<JsonWebKey>(*globalObject, keyJSValue);
            RETURN_IF_EXCEPTION(scope, {});
            if (jwk.kty == "OKP"_s) {
                if (jwk.crv == "Ed25519"_s) {
                    auto result = CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(jwk), true, CryptoKeyUsageSign);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 private key"_s));
                        return {};
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() != CryptoKeyType::Private) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                        return {};
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else if (jwk.crv == "X25519"_s) {
                    auto result = CryptoKeyOKP::importJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::X25519, WTFMove(jwk), true, CryptoKeyUsageSign);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 private key"_s));
                        return {};
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() != CryptoKeyType::Private) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                        return {};
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else {
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported OKP curve"_s));
                    return {};
                }
            } else if (jwk.kty == "EC"_s) {
                auto result = CryptoKeyEC::importJwk(CryptoAlgorithmIdentifier::ECDSA, jwk.crv, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                if (impl->type() != CryptoKeyType::Private) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                    return {};
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (jwk.kty == "RSA"_s) {
                auto result = CryptoKeyRSA::importJwk(CryptoAlgorithmIdentifier::RSA_OAEP, std::nullopt, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid RSA private key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                if (impl->type() != CryptoKeyType::Private) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                    return {};
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported private key"_s));
                return {};
            }
        }
        JSC::throwTypeError(globalObject, scope, "The \"key\" property must be of type object"_s);
        return {};
    }
    }

    if (format == "jwk"_s) {
        JSC::throwTypeError(globalObject, scope, "The \"key\" property must be of type object"_s);
        return {};
    }

    if (UNLIKELY(!data) || UNLIKELY(!byteLength)) {
        throwException(globalObject, scope, createTypeError(globalObject, "ERR_INVALID_ARG_TYPE: expected key to be Buffer or array-like object"_s));
        return {};
    }

    JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
    KeyPassphrase passphrase(passphraseJSValue, globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});

    if (format == "pem"_s) {
        ASSERT(data);
        auto bio = BIOPtr(BIO_new_mem_buf(const_cast<char*>((char*)data), byteLength));
        auto pkey = EvpPKeyPtr(PEM_read_bio_PrivateKey(bio.get(), nullptr, PasswordCallback, &passphrase));

        if (!pkey) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key pem file"_s));
            return {};
        }
        auto pKeyID = EVP_PKEY_id(pkey.get());

        if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageDecrypt);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_ED25519 || pKeyID == EVP_PKEY_X25519) {
            size_t out_len = 0;
            if (!EVP_PKEY_get_raw_private_key(pkey.get(), nullptr, &out_len)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return {};
            }
            Vector<uint8_t> out(out_len);
            if (!EVP_PKEY_get_raw_private_key(pkey.get(), out.data(), &out_len) || out_len != out.size()) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return {};
            }
            auto result = CryptoKeyOKP::create(CryptoAlgorithmIdentifier::Ed25519, pKeyID == EVP_PKEY_ED25519 ? CryptoKeyOKP::NamedCurve::Ed25519 : CryptoKeyOKP::NamedCurve::X25519, CryptoKeyType::Private, WTFMove(out), true, CryptoKeyUsageSign);
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return {};
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_EC) {
            EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
            if (UNLIKELY(ec_key == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                return {};
            }
            const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
            // Get the curve name
            int curve_name = EC_GROUP_get_curve_name(ec_group);
            if (curve_name == NID_undef) {
                EC_KEY_free(ec_key);
                throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                return {};
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
                return {};
            }
            EC_KEY_free(ec_key);
            auto impl = CryptoKeyEC::create(CryptoAlgorithmIdentifier::ECDH, curve, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageSign);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else {
            throwException(globalObject, scope, createTypeError(globalObject, "Unsupported private key"_s));
            return {};
        }
    }
    if (format == "der"_s) {
        JSValue typeJSValue = options->getIfPropertyExists(globalObject, PropertyName(vm.propertyNames->type));
        WTF::String type = "pkcs8"_s;
        if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
            if (!typeJSValue.isString()) {
                JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                return {};
            }
            type = typeJSValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }

        if (type == "pkcs1"_s) {
            // must be RSA
            const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
            auto pkey = EvpPKeyPtr(d2i_PrivateKey(EVP_PKEY_RSA, nullptr, &p, byteLength));
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid use of PKCS#1 as private key"_s));
                return {};
            }
            auto pKeyID = EVP_PKEY_id(pkey.get());
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5 : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageDecrypt);
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
                    return {};
                }
                pkey = EvpPKeyPtr(EVP_PKCS82PKEY(p8inf));
            }
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
                return {};
            }
            auto pKeyID = EVP_PKEY_id(pkey.get());

            if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
                auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageDecrypt);
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_ED25519) {
                auto result = CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageSign);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 private key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_X25519) {
                auto result = CryptoKeyOKP::importPkcs8(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageDeriveKey);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 private key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_EC) {
                EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
                if (UNLIKELY(ec_key == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return {};
                }
                const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
                // Get the curve name
                int curve_name = EC_GROUP_get_curve_name(ec_group);
                if (curve_name == NID_undef) {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                    return {};
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
                    return {};
                }
                auto result = CryptoKeyEC::platformImportPkcs8(CryptoAlgorithmIdentifier::ECDH, curve, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageSign);
                if (UNLIKELY(result == nullptr)) {
                    result = CryptoKeyEC::platformImportPkcs8(CryptoAlgorithmIdentifier::ECDSA, curve, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageSign);
                }
                EC_KEY_free(ec_key);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported private key"_s));
                return {};
            }
        } else if (type == "sec1"_s) {
            const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
            auto pkey = EvpPKeyPtr(d2i_PrivateKey(EVP_PKEY_EC, nullptr, &p, byteLength));
            auto pKeyID = EVP_PKEY_id(pkey.get());

            if (pKeyID == EVP_PKEY_EC) {
                EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
                if (UNLIKELY(ec_key == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                    return {};
                }
                const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
                // Get the curve name
                int curve_name = EC_GROUP_get_curve_name(ec_group);
                if (curve_name == NID_undef) {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                    return {};
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
                    return {};
                }
                EC_KEY_free(ec_key);
                auto impl = CryptoKeyEC::create(CryptoAlgorithmIdentifier::ECDH, curve, CryptoKeyType::Private, WTFMove(pkey), true, CryptoKeyUsageSign);
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC private key"_s));
                return {};
            }
        }

        JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1', 'pkcs8' or 'sec1'"_s);
        return {};
    }

    JSC::throwTypeError(globalObject, scope, "format should be 'pem' or 'der'"_s);
    return {};
}

static JSC::EncodedJSValue KeyObject__createRSAFromPrivate(JSC::JSGlobalObject* globalObject, EVP_PKEY* pkey, WebCore::CryptoAlgorithmIdentifier alg)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const RSA* rsa_key = EVP_PKEY_get0_RSA(pkey);

    auto publicRSA = RSAPtr(RSAPublicKey_dup(rsa_key));
    if (!publicRSA) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private"_s);
        return {};
    }
    auto publicPKey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_RSA(publicPKey.get(), publicRSA.get()) <= 0) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private"_s);
        return {};
    }
    auto impl = CryptoKeyRSA::create(alg, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(publicPKey), true, CryptoKeyUsageVerify);
    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
}

static JSC::EncodedJSValue KeyObject__createECFromPrivate(JSC::JSGlobalObject* globalObject, EVP_PKEY* pkey, CryptoKeyEC::NamedCurve namedCurve, WebCore::CryptoAlgorithmIdentifier alg)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    EC_KEY* ec_key = EVP_PKEY_get0_EC_KEY(pkey);
    auto point = ECPointPtr(EC_POINT_dup(EC_KEY_get0_public_key(ec_key), EC_KEY_get0_group(ec_key)));
    if (!point) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 1"_s);
        return {};
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
        return {};
    }
    // OPENSSL_EC_NAMED_CURVE needs to be set to export the key with the curve name, not with the curve parameters.
    EC_KEY_set_asn1_flag(publicECKey.get(), OPENSSL_EC_NAMED_CURVE);
    if (EC_KEY_set_public_key(publicECKey.get(), point.get()) <= 0) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 3"_s);
        return {};
    }
    auto publicPKey = EvpPKeyPtr(EVP_PKEY_new());
    if (EVP_PKEY_set1_EC_KEY(publicPKey.get(), publicECKey.get()) <= 0) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private 4"_s);
        return {};
    }
    auto impl = CryptoKeyEC::create(alg, namedCurve, CryptoKeyType::Public, WTFMove(publicPKey), true, CryptoKeyUsageVerify);

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
}

static JSC::EncodedJSValue KeyObject__createOKPFromPrivate(JSC::JSGlobalObject* globalObject, const WebCore::CryptoKeyOKP::KeyMaterial keyData, CryptoKeyOKP::NamedCurve namedCurve, WebCore::CryptoAlgorithmIdentifier alg)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Vector<unsigned char> public_key(ED25519_PUBLIC_KEY_LEN);

    if (namedCurve == CryptoKeyOKP::NamedCurve::Ed25519) {
        memcpy(public_key.data(), keyData.data() + ED25519_PRIVATE_KEY_LEN, ED25519_PUBLIC_KEY_LEN);
    } else {
        X25519_public_from_private(public_key.data(), keyData.data());
    }
    auto result = CryptoKeyOKP::create(alg, namedCurve, CryptoKeyType::Public, WTFMove(public_key), true, CryptoKeyUsageVerify);
    if (UNLIKELY(result == nullptr)) {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Failed to create a public key from private"_s);
        return {};
    }
    auto impl = result.releaseNonNull();

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
}

static JSC::EncodedJSValue KeyObject__createPublicFromPrivate(JSC::JSGlobalObject* globalObject, EVP_PKEY* pkey)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto pKeyID = EVP_PKEY_id(pkey);
    if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
        return KeyObject__createRSAFromPrivate(globalObject, pkey, pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP);
    } else if (pKeyID == EVP_PKEY_EC) {

        EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey);
        if (UNLIKELY(ec_key == nullptr)) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC key"_s));
            return {};
        }
        const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
        // Get the curve name
        int curve_name = EC_GROUP_get_curve_name(ec_group);
        if (curve_name == NID_undef) {
            EC_KEY_free(ec_key);
            throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
            return {};
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
            return {};
        }
        EC_KEY_free(ec_key);
        return KeyObject__createECFromPrivate(globalObject, pkey, curve, CryptoAlgorithmIdentifier::ECDSA);
    } else if (pKeyID == EVP_PKEY_ED25519 || pKeyID == EVP_PKEY_X25519) {
        size_t out_len = 0;
        if (!EVP_PKEY_get_raw_private_key(pkey, nullptr, &out_len)) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
            return {};
        }
        Vector<uint8_t> out(out_len);
        if (!EVP_PKEY_get_raw_private_key(pkey, out.data(), &out_len) || out_len != out.size()) {
            throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key"_s));
            return {};
        }
        return KeyObject__createOKPFromPrivate(globalObject, out, pKeyID == EVP_PKEY_ED25519 ? CryptoKeyOKP::NamedCurve::Ed25519 : CryptoKeyOKP::NamedCurve::X25519, CryptoAlgorithmIdentifier::Ed25519);
    } else {
        throwException(globalObject, scope, createTypeError(globalObject, "Invalid private key type"_s));
        return {};
    }
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__createPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 1) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "createPublicKey requires 1 arguments"_s);
        return {};
    }
    auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(0));
    if (!options) {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return {};
    }
    JSValue keyJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "key"_s)));
    if (keyJSValue.isUndefinedOrNull() || keyJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "key is required"_s);
        return {};
    }
    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();

    void* data = nullptr;
    size_t byteLength = 0;
    if (auto* key = jsDynamicCast<JSCryptoKey*>(keyJSValue)) {
        auto& wrapped = key->wrapped();
        auto key_type = wrapped.type();
        if (key_type != CryptoKeyType::Private) {
            JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Invalid key object type, expected private"_s);
            return {};
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
            return {};
        }
        }
    }
    if (!keyJSValue.isCell()) {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return {};
    }

    JSValue formatJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "format"_s)));
    if (formatJSValue.isUndefinedOrNull() || formatJSValue.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "format is required"_s);
        return {};
    }
    if (!formatJSValue.isString()) {
        JSC::throwTypeError(globalObject, scope, "format must be a string"_s);
        return {};
    }
    auto format = formatJSValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

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
    case Float16ArrayType:
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
            return {};
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
                return {};
            }
            auto jwk = WebCore::convertDictionary<JsonWebKey>(*globalObject, keyJSValue);
            RETURN_IF_EXCEPTION(scope, {});
            if (jwk.kty == "OKP"_s) {
                if (jwk.crv == "Ed25519"_s) {
                    auto result = CryptoKeyOKP::importPublicJwk(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, WTFMove(jwk), true, CryptoKeyUsageVerify);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                        return {};
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() == CryptoKeyType::Private) {
                        return KeyObject__createOKPFromPrivate(globalObject, impl.get().exportKey(), CryptoKeyOKP::NamedCurve::Ed25519, CryptoAlgorithmIdentifier::Ed25519);
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else if (jwk.crv == "X25519"_s) {
                    auto result = CryptoKeyOKP::importPublicJwk(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, WTFMove(jwk), true, CryptoKeyUsageDeriveKey);
                    if (UNLIKELY(result == nullptr)) {
                        throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 public key"_s));
                        return {};
                    }
                    auto impl = result.releaseNonNull();
                    if (impl->type() == CryptoKeyType::Private) {
                        return KeyObject__createOKPFromPrivate(globalObject, impl.get().exportKey(), CryptoKeyOKP::NamedCurve::X25519, CryptoAlgorithmIdentifier::Ed25519);
                    }
                    return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
                } else {
                    throwException(globalObject, scope, createTypeError(globalObject, "Unsupported OKP curve"_s));
                    return {};
                }
            } else if (jwk.kty == "EC"_s) {
                auto result = CryptoKeyEC::importJwk(CryptoAlgorithmIdentifier::ECDSA, jwk.crv, WTFMove(jwk), true, jwk.usages);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                    return {};
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
                    return {};
                }
                auto impl = result.releaseNonNull();
                if (impl->type() == CryptoKeyType::Private) {
                    return KeyObject__createRSAFromPrivate(globalObject, impl.get().platformKey(), CryptoAlgorithmIdentifier::RSA_OAEP);
                }
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported public key"_s));
                return {};
            }
        }
    }
    }

    if (format == "jwk"_s) {
        JSC::throwTypeError(globalObject, scope, "The \"key\" property must be of type object"_s);
        return {};
    }

    if (UNLIKELY(!data) || UNLIKELY(!byteLength)) {
        throwException(globalObject, scope, createTypeError(globalObject, "ERR_INVALID_ARG_TYPE: expected key to be Buffer or array-like object"_s));
        return {};
    }

    if (format == "pem"_s) {
        auto pem = KeyObject__ParsePublicKeyPEM((const char*)data, byteLength);
        if (!pem.key) {
            // maybe is a private pem
            auto bio = BIOPtr(BIO_new_mem_buf(const_cast<char*>((char*)data), byteLength));
            JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
            KeyPassphrase passphrase(passphraseJSValue, globalObject, scope);
            RETURN_IF_EXCEPTION(scope, {});
            auto pkey = EvpPKeyPtr(PEM_read_bio_PrivateKey(bio.get(), nullptr, PasswordCallback, &passphrase));
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid PEM data"_s));
                return {};
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
            auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, Vector<uint8_t>(std::span { (uint8_t*)pem.der_data, (size_t)pem.der_len }), true, CryptoKeyUsageVerify);
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                return {};
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (pKeyID == EVP_PKEY_X25519) {
            auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, Vector<uint8_t>(std::span { (uint8_t*)pem.der_data, (size_t)pem.der_len }), true, CryptoKeyUsageDeriveKey);
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 public key"_s));
                return {};
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
                return {};
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
                return {};
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
                return {};
            }
            auto result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDH, curve, Vector<uint8_t>(std::span { (uint8_t*)pem.der_data, (size_t)pem.der_len }), true, CryptoKeyUsageVerify);
            if (UNLIKELY(result == nullptr)) {
                result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDSA, curve, Vector<uint8_t>(std::span { (uint8_t*)pem.der_data, (size_t)pem.der_len }), true, CryptoKeyUsageVerify);
            }
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            if (UNLIKELY(result == nullptr)) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                return {};
            }
            auto impl = result.releaseNonNull();
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else {
            if (pem.der_data) {
                OPENSSL_clear_free(pem.der_data, pem.der_len);
            }
            throwException(globalObject, scope, createTypeError(globalObject, "Unsupported public key"_s));
            return {};
        }
    }
    if (format == "der"_s) {
        JSValue typeJSValue = options->getIfPropertyExists(globalObject, PropertyName(vm.propertyNames->type));
        WTF::String type = "spki"_s;
        if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
            if (!typeJSValue.isString()) {
                JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                return {};
            }
            type = typeJSValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
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
                    return {};
                }

                auto pKeyID = EVP_PKEY_id(pkey.get());
                return KeyObject__createRSAFromPrivate(globalObject, pkey.get(), pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5 : CryptoAlgorithmIdentifier::RSA_OAEP);
            }

            auto pKeyID = EVP_PKEY_id(pkey.get());
            auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5 : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(pkey), true, CryptoKeyUsageEncrypt);
            return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
        } else if (type == "spki"_s) {
            // We use d2i_PUBKEY() to import a public key.
            const uint8_t* ptr = reinterpret_cast<const uint8_t*>(data);
            auto pkey = EvpPKeyPtr(d2i_PUBKEY(nullptr, &ptr, byteLength));
            if (!pkey) {
                throwException(globalObject, scope, createTypeError(globalObject, "Invalid public key"_s));
                return {};
            }
            auto pKeyID = EVP_PKEY_id(pkey.get());

            if (pKeyID == EVP_PKEY_RSA || pKeyID == EVP_PKEY_RSA_PSS) {
                auto impl = CryptoKeyRSA::create(pKeyID == EVP_PKEY_RSA_PSS ? CryptoAlgorithmIdentifier::RSA_PSS : CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, CryptoKeyType::Public, WTFMove(pkey), true, CryptoKeyUsageEncrypt);
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_ED25519) {
                auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::Ed25519, CryptoKeyOKP::NamedCurve::Ed25519, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageVerify);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid Ed25519 public key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_X25519) {
                auto result = CryptoKeyOKP::importSpki(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageDeriveKey);
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid X25519 public key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else if (pKeyID == EVP_PKEY_EC) {
                EC_KEY* ec_key = EVP_PKEY_get1_EC_KEY(pkey.get());
                if (UNLIKELY(ec_key == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                    return {};
                }
                const EC_GROUP* ec_group = EC_KEY_get0_group(ec_key);
                // Get the curve name
                int curve_name = EC_GROUP_get_curve_name(ec_group);
                if (curve_name == NID_undef) {
                    EC_KEY_free(ec_key);
                    throwException(globalObject, scope, createTypeError(globalObject, "Unable to identify EC curve"_s));
                    return {};
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
                    return {};
                }
                auto result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDH, curve, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageVerify);
                if (UNLIKELY(result == nullptr)) {
                    result = CryptoKeyEC::platformImportSpki(CryptoAlgorithmIdentifier::ECDSA, curve, Vector<uint8_t>(std::span { (uint8_t*)data, byteLength }), true, CryptoKeyUsageVerify);
                }
                if (UNLIKELY(result == nullptr)) {
                    throwException(globalObject, scope, createTypeError(globalObject, "Invalid EC public key"_s));
                    return {};
                }
                auto impl = result.releaseNonNull();
                return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, WTFMove(impl)));
            } else {
                throwException(globalObject, scope, createTypeError(globalObject, "Unsupported public key"_s));
                return {};
            }
        }

        JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
        return {};
    }
    JSC::throwTypeError(globalObject, scope, "format should be 'pem' or 'der'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__createSecretKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    JSValue bufferArg = callFrame->uncheckedArgument(0);
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* structure = globalObject->JSCryptoKeyStructure();

    if (!bufferArg.isCell()) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_INVALID_ARG_TYPE: expected Buffer or array-like object"_s));
        return {};
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
    case Float16ArrayType:
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
    default: {
        break;
    }
    }

    throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_INVALID_ARG_TYPE: expected Buffer or array-like object"_s));
    return {};
}

ExceptionOr<Vector<uint8_t>> KeyObject__GetBuffer(JSValue bufferArg)
{
    if (!bufferArg.isCell()) {
        return Exception { OperationError };
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
    case Float16ArrayType:
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
        return Vector<uint8_t>(std::span { (uint8_t*)data, byteLength });
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
        return Vector<uint8_t>(std::span { (uint8_t*)data, byteLength });
    }
    default: {
        break;
    }
    }
    return Exception { OperationError };
}
JSC_DEFINE_HOST_FUNCTION(KeyObject__Sign, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 3) {
        JSC::throwTypeError(globalObject, scope, "sign requires 3 arguments"_s);
        return {};
    }

    auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0));
    if (!key) {
        // No JSCryptoKey instance
        JSC::throwTypeError(globalObject, scope, "expected CryptoKey as first argument"_s);
        return {};
    }
    JSValue bufferArg = callFrame->uncheckedArgument(1);

    auto buffer = KeyObject__GetBuffer(bufferArg);
    if (buffer.hasException()) {
        JSC::throwTypeError(globalObject, scope, "expected Buffer or array-like object as second argument"_s);
        return {};
    }
    auto vectorData = buffer.releaseReturnValue();
    auto& wrapped = key->wrapped();
    auto id = wrapped.keyClass();

    auto hash = WebCore::CryptoAlgorithmIdentifier::SHA_256;
    auto algorithm = callFrame->argument(2);
    auto customHash = false;
    if (!algorithm.isUndefinedOrNull() && !algorithm.isEmpty()) {
        customHash = true;
        if (!algorithm.isString()) {
            JSC::throwTypeError(globalObject, scope, "algorithm is expected to be a string"_s);
            return {};
        }
        auto algorithm_str = algorithm.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto identifier = CryptoAlgorithmRegistry::singleton().identifier(algorithm_str);
        if (UNLIKELY(!identifier)) {
            JSC::throwTypeError(globalObject, scope, "digest not allowed"_s);
            return {};
        }

        switch (*identifier) {
        case WebCore::CryptoAlgorithmIdentifier::SHA_1:
        case WebCore::CryptoAlgorithmIdentifier::SHA_224:
        case WebCore::CryptoAlgorithmIdentifier::SHA_256:
        case WebCore::CryptoAlgorithmIdentifier::SHA_384:
        case WebCore::CryptoAlgorithmIdentifier::SHA_512: {

            hash = *identifier;
            break;
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "digest not allowed"_s);
            return {};
        }
        }
    }

    switch (id) {
    case CryptoKeyClass::HMAC: {
        const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(wrapped);
        auto result = (customHash) ? WebCore::CryptoAlgorithmHMAC::platformSignWithAlgorithm(hmac, hash, vectorData) : WebCore::CryptoAlgorithmHMAC::platformSign(hmac, vectorData);
        if (result.hasException()) {
            WebCore::propagateException(*globalObject, scope, result.releaseException());
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto resultData = result.releaseReturnValue();
        auto* buffer = createBuffer(globalObject, resultData);
        return JSC::JSValue::encode(buffer);
    }
    case CryptoKeyClass::OKP: {
        const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(wrapped);
        auto result = WebCore::CryptoAlgorithmEd25519::platformSign(okpKey, vectorData);
        if (result.hasException()) {
            WebCore::propagateException(*globalObject, scope, result.releaseException());
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto resultData = result.releaseReturnValue();
        auto* buffer = WebCore::createBuffer(globalObject, resultData);
        return JSC::JSValue::encode(buffer);
    }
    case CryptoKeyClass::EC: {
        const auto& ec = downcast<WebCore::CryptoKeyEC>(wrapped);
        CryptoAlgorithmEcdsaParams params;
        params.identifier = CryptoAlgorithmIdentifier::ECDSA;
        params.hashIdentifier = hash;
        params.encoding = CryptoAlgorithmECDSAEncoding::DER;

        if (count > 3) {
            auto encoding = callFrame->argument(3);
            if (!encoding.isUndefinedOrNull() && !encoding.isEmpty()) {
                if (!encoding.isString()) {
                    JSC::throwTypeError(globalObject, scope, "dsaEncoding is expected to be a string"_s);
                    return {};
                }
                auto encoding_str = encoding.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});

                if (encoding_str == "ieee-p1363"_s) {
                    params.encoding = CryptoAlgorithmECDSAEncoding::IeeeP1363;
                } else if (encoding_str == "der"_s) {
                    params.encoding = CryptoAlgorithmECDSAEncoding::DER;
                } else {
                    JSC::throwTypeError(globalObject, scope, "invalid dsaEncoding"_s);
                    return {};
                }
            }
        }
        auto result = WebCore::CryptoAlgorithmECDSA::platformSign(params, ec, vectorData);
        if (result.hasException()) {
            WebCore::propagateException(*globalObject, scope, result.releaseException());
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        auto resultData = result.releaseReturnValue();
        auto* buffer = WebCore::createBuffer(globalObject, resultData);
        return JSC::JSValue::encode(buffer);
    }
    case CryptoKeyClass::RSA: {
        const auto& rsa = downcast<WebCore::CryptoKeyRSA>(wrapped);
        CryptoAlgorithmIdentifier restrict_hash;
        bool isRestrictedToHash = rsa.isRestrictedToHash(restrict_hash);
        if (isRestrictedToHash && hash != restrict_hash) {
            JSC::throwTypeError(globalObject, scope, "digest not allowed"_s);
            return {};
        }
        switch (rsa.algorithmIdentifier()) {
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5: {
            auto result = (customHash) ? WebCore::CryptoAlgorithmRSASSA_PKCS1_v1_5::platformSignWithAlgorithm(rsa, hash, vectorData) : CryptoAlgorithmRSASSA_PKCS1_v1_5::platformSign(rsa, vectorData);
            if (result.hasException()) {
                WebCore::propagateException(*globalObject, scope, result.releaseException());
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            auto resultData = result.releaseReturnValue();
            auto* buffer = WebCore::createBuffer(globalObject, resultData);

            return JSC::JSValue::encode(buffer);
        }
        case CryptoAlgorithmIdentifier::RSA_PSS: {
            CryptoAlgorithmRsaPssParams params;
            params.padding = RSA_PKCS1_PADDING;
            if (count > 4) {
                auto padding = callFrame->argument(4);
                if (!padding.isUndefinedOrNull() && !padding.isEmpty()) {
                    if (!padding.isNumber()) {
                        JSC::throwTypeError(globalObject, scope, "padding is expected to be a number"_s);
                        return {};
                    }
                    params.padding = padding.toUInt32(globalObject);
                }
                // requires saltLength
                if (params.padding == RSA_PKCS1_PSS_PADDING) {
                    if (count <= 5) {
                        JSC::throwTypeError(globalObject, scope, "saltLength is expected to be a number"_s);
                        return {};
                    }

                    auto saltLength = callFrame->argument(5);
                    if (saltLength.isUndefinedOrNull() || saltLength.isEmpty() || !saltLength.isNumber()) {
                        JSC::throwTypeError(globalObject, scope, "saltLength is expected to be a number"_s);
                        return {};
                    }
                    params.saltLength = saltLength.toUInt32(globalObject);
                } else if (count > 5) {
                    auto saltLength = callFrame->argument(5);
                    if (!saltLength.isUndefinedOrNull() && !saltLength.isEmpty() && !saltLength.isNumber()) {
                        JSC::throwTypeError(globalObject, scope, "saltLength is expected to be a number"_s);
                        return {};
                    }
                    params.saltLength = saltLength.toUInt32(globalObject);
                    params.padding = RSA_PKCS1_PSS_PADDING; // if saltLength is provided, padding must be RSA_PKCS1_PSS_PADDING
                }
            }
            params.identifier = CryptoAlgorithmIdentifier::RSA_PSS;
            auto result = (customHash) ? WebCore::CryptoAlgorithmRSA_PSS::platformSignWithAlgorithm(params, hash, rsa, vectorData) : CryptoAlgorithmRSA_PSS::platformSign(params, rsa, vectorData);
            if (result.hasException()) {
                WebCore::propagateException(*globalObject, scope, result.releaseException());
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            auto resultData = result.releaseReturnValue();
            auto* buffer = WebCore::createBuffer(globalObject, resultData);

            return JSC::JSValue::encode(buffer);
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Sign not supported for this key type"_s);
            return {};
        }
        }
    }
    case CryptoKeyClass::AES: {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Sign not supported for AES key type"_s);
        return {};
    }
    case CryptoKeyClass::Raw: {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Sign not supported for Raw key type"_s);
        return {};
    }
    default: {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Sign not supported for this key type"_s);
        return {};
    }
    }
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__Verify, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 4) {
        JSC::throwTypeError(globalObject, scope, "verify requires 4 arguments"_s);
        return {};
    }

    auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0));
    if (!key) {
        // No JSCryptoKey instance
        JSC::throwTypeError(globalObject, scope, "expected CryptoKey as first argument"_s);
        return {};
    }
    JSValue bufferArg = callFrame->uncheckedArgument(1);
    auto buffer = KeyObject__GetBuffer(bufferArg);
    if (buffer.hasException()) {
        JSC::throwTypeError(globalObject, scope, "expected data to be Buffer or array-like object as second argument"_s);
        return {};
    }
    auto vectorData = buffer.releaseReturnValue();

    JSValue signatureBufferArg = callFrame->uncheckedArgument(2);
    auto signatureBuffer = KeyObject__GetBuffer(signatureBufferArg);
    if (signatureBuffer.hasException()) {
        JSC::throwTypeError(globalObject, scope, "expected signature to be Buffer or array-like object as second argument"_s);
        return {};
    }
    auto signatureData = signatureBuffer.releaseReturnValue();

    auto& wrapped = key->wrapped();
    auto id = wrapped.keyClass();

    auto hash = WebCore::CryptoAlgorithmIdentifier::SHA_256;
    auto customHash = false;

    auto algorithm = callFrame->argument(3);
    if (!algorithm.isUndefinedOrNull() && !algorithm.isEmpty()) {
        customHash = true;
        if (!algorithm.isString()) {
            JSC::throwTypeError(globalObject, scope, "algorithm is expected to be a string"_s);
            return {};
        }
        auto algorithm_str = algorithm.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto identifier = CryptoAlgorithmRegistry::singleton().identifier(algorithm_str);
        if (UNLIKELY(!identifier)) {
            JSC::throwTypeError(globalObject, scope, "digest not allowed"_s);
            return {};
        }

        switch (*identifier) {
        case WebCore::CryptoAlgorithmIdentifier::SHA_1:
        case WebCore::CryptoAlgorithmIdentifier::SHA_224:
        case WebCore::CryptoAlgorithmIdentifier::SHA_256:
        case WebCore::CryptoAlgorithmIdentifier::SHA_384:
        case WebCore::CryptoAlgorithmIdentifier::SHA_512: {

            hash = *identifier;
            break;
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "digest not allowed"_s);
            return {};
        }
        }
    }

    switch (id) {
    case CryptoKeyClass::HMAC: {
        const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(wrapped);
        auto result = (customHash) ? WebCore::CryptoAlgorithmHMAC::platformVerifyWithAlgorithm(hmac, hash, signatureData, vectorData) : WebCore::CryptoAlgorithmHMAC::platformVerify(hmac, signatureData, vectorData);
        if (result.hasException()) {
            Exception exception = result.releaseException();
            if (exception.code() == WebCore::ExceptionCode::OperationError) {
                return JSValue::encode(jsBoolean(false));
            }
            WebCore::propagateException(*globalObject, scope, WTFMove(exception));
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        return JSC::JSValue::encode(jsBoolean(result.releaseReturnValue()));
    }
    case CryptoKeyClass::OKP: {
        const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(wrapped);
        auto result = WebCore::CryptoAlgorithmEd25519::platformVerify(okpKey, signatureData, vectorData);
        if (result.hasException()) {
            Exception exception = result.releaseException();
            if (exception.code() == WebCore::ExceptionCode::OperationError) {
                return JSValue::encode(jsBoolean(false));
            }
            WebCore::propagateException(*globalObject, scope, WTFMove(exception));
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        return JSC::JSValue::encode(jsBoolean(result.releaseReturnValue()));
    }
    case CryptoKeyClass::EC: {
        const auto& ec = downcast<WebCore::CryptoKeyEC>(wrapped);
        CryptoAlgorithmEcdsaParams params;
        params.identifier = CryptoAlgorithmIdentifier::ECDSA;
        params.hashIdentifier = hash;
        params.encoding = CryptoAlgorithmECDSAEncoding::DER;

        if (count > 4) {
            auto encoding = callFrame->argument(4);
            if (!encoding.isUndefinedOrNull() && !encoding.isEmpty()) {
                if (!encoding.isString()) {
                    JSC::throwTypeError(globalObject, scope, "dsaEncoding is expected to be a string"_s);
                    return {};
                }
                auto encoding_str = encoding.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});

                if (encoding_str == "ieee-p1363"_s) {
                    params.encoding = CryptoAlgorithmECDSAEncoding::IeeeP1363;
                } else if (encoding_str == "der"_s) {
                    params.encoding = CryptoAlgorithmECDSAEncoding::DER;
                } else {
                    JSC::throwTypeError(globalObject, scope, "invalid dsaEncoding"_s);
                    return {};
                }
            }
        }
        auto result = WebCore::CryptoAlgorithmECDSA::platformVerify(params, ec, signatureData, vectorData);
        if (result.hasException()) {
            Exception exception = result.releaseException();
            if (exception.code() == WebCore::ExceptionCode::OperationError) {
                return JSValue::encode(jsBoolean(false));
            }
            WebCore::propagateException(*globalObject, scope, WTFMove(exception));
            return JSC::JSValue::encode(JSC::JSValue {});
        }
        return JSC::JSValue::encode(jsBoolean(result.releaseReturnValue()));
    }
    case CryptoKeyClass::RSA: {
        const auto& rsa = downcast<WebCore::CryptoKeyRSA>(wrapped);
        CryptoAlgorithmIdentifier restrict_hash;
        bool isRestrictedToHash = rsa.isRestrictedToHash(restrict_hash);
        if (isRestrictedToHash && hash != restrict_hash) {
            JSC::throwTypeError(globalObject, scope, "digest not allowed"_s);
            return {};
        }
        switch (rsa.algorithmIdentifier()) {
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5: {
            auto result = (customHash) ? WebCore::CryptoAlgorithmRSASSA_PKCS1_v1_5::platformVerifyWithAlgorithm(rsa, hash, signatureData, vectorData) : CryptoAlgorithmRSASSA_PKCS1_v1_5::platformVerify(rsa, signatureData, vectorData);
            if (result.hasException()) {
                Exception exception = result.releaseException();
                if (exception.code() == WebCore::ExceptionCode::OperationError) {
                    return JSValue::encode(jsBoolean(false));
                }
                WebCore::propagateException(*globalObject, scope, WTFMove(exception));
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            return JSC::JSValue::encode(jsBoolean(result.releaseReturnValue()));
        }
        case CryptoAlgorithmIdentifier::RSA_PSS: {
            CryptoAlgorithmRsaPssParams params;
            params.padding = RSA_PKCS1_PADDING;
            if (count > 5) {

                auto padding = callFrame->argument(5);
                if (!padding.isUndefinedOrNull() && !padding.isEmpty()) {
                    if (!padding.isNumber()) {
                        JSC::throwTypeError(globalObject, scope, "padding is expected to be a number"_s);
                        return {};
                    }
                    params.padding = padding.toUInt32(globalObject);
                }
                // requires saltLength
                if (params.padding == RSA_PKCS1_PSS_PADDING) {
                    if (count <= 6) {
                        JSC::throwTypeError(globalObject, scope, "saltLength is expected to be a number"_s);
                        return {};
                    }

                    auto saltLength = callFrame->argument(6);
                    if (saltLength.isUndefinedOrNull() || saltLength.isEmpty() || !saltLength.isNumber()) {
                        JSC::throwTypeError(globalObject, scope, "saltLength is expected to be a number"_s);
                        return {};
                    }
                    params.saltLength = saltLength.toUInt32(globalObject);
                } else if (count > 6) {
                    auto saltLength = callFrame->argument(6);
                    if (!saltLength.isUndefinedOrNull() && !saltLength.isEmpty() && !saltLength.isNumber()) {
                        JSC::throwTypeError(globalObject, scope, "saltLength is expected to be a number"_s);
                        return {};
                    }
                    params.saltLength = saltLength.toUInt32(globalObject);
                    params.padding = RSA_PKCS1_PSS_PADDING; // if saltLength is provided, padding must be RSA_PKCS1_PSS_PADDING
                }
            }
            params.identifier = CryptoAlgorithmIdentifier::RSA_PSS;
            auto result = (customHash) ? WebCore::CryptoAlgorithmRSA_PSS::platformVerifyWithAlgorithm(params, hash, rsa, signatureData, vectorData) : CryptoAlgorithmRSA_PSS::platformVerify(params, rsa, signatureData, vectorData);
            if (result.hasException()) {
                Exception exception = result.releaseException();
                if (exception.code() == WebCore::ExceptionCode::OperationError) {
                    return JSValue::encode(jsBoolean(false));
                }
                WebCore::propagateException(*globalObject, scope, WTFMove(exception));
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            return JSC::JSValue::encode(jsBoolean(result.releaseReturnValue()));
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Verify not supported for RSA key type"_s);
            return {};
        }
        }
    }
    case CryptoKeyClass::AES: {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Verify not supported for AES key type"_s);
        return {};
    }
    case CryptoKeyClass::Raw: {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Verify not supported for Raw key type"_s);
        return {};
    }
    default: {
        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: Verify not supported for this key type"_s);
        return {};
    }
    }
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__Exports, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 2) {
        JSC::throwTypeError(globalObject, scope, "exports requires 2 arguments"_s);
        return {};
    }

    auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0));
    if (!key) {
        // No JSCryptoKey instance
        JSC::throwTypeError(globalObject, scope, "expected CryptoKey as first argument"_s);
        return {};
    }

    auto& wrapped = key->wrapped();
    auto key_type = wrapped.type();
    auto id = wrapped.keyClass();
    if (auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1))) {
        JSValue formatJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "format"_s)));
        JSValue typeJSValue = options->getIfPropertyExists(globalObject, PropertyName(vm.propertyNames->type));
        JSValue passphraseJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "passphrase"_s)));
        KeyPassphrase passphrase(passphraseJSValue, globalObject, scope);
        RETURN_IF_EXCEPTION(scope, {});
        if (formatJSValue.isUndefinedOrNull() || formatJSValue.isEmpty()) {
            JSC::throwTypeError(globalObject, scope, "format is expected to be a string"_s);
            return {};
        }

        auto string = formatJSValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (string == "jwk"_s && passphrase.hasPassphrase()) {
            JSC::throwTypeError(globalObject, scope, "encryption is not supported for jwk format"_s);
            return {};
        }

        switch (id) {
        case CryptoKeyClass::HMAC: {
            const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(wrapped);
            if (string == "buffer"_s) {
                auto keyData = hmac.key();
                auto* buffer = createBuffer(globalObject, keyData);

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
                auto* buffer = createBuffer(globalObject, keyData);

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
                if (rsa.algorithmIdentifier() == CryptoAlgorithmIdentifier::RSA_PSS) {
                    JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE: encryption is not supported for jwk format"_s);
                    return {};
                }
                const JsonWebKey& jwkValue = rsa.exportJwk();
                Zig::GlobalObject* domGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
                return JSC::JSValue::encode(WebCore::convertDictionaryToJS(*globalObject, *domGlobalObject, jwkValue, true));
            } else {
                WTF::String type = "pkcs1"_s;

                if (!typeJSValue.isUndefinedOrNull() && !typeJSValue.isEmpty()) {
                    if (!typeJSValue.isString()) {
                        JSC::throwTypeError(globalObject, scope, "type must be a string"_s);
                        return {};
                    }
                    type = typeJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                if (type == "pkcs1"_s) {
                    if (rsa.algorithmIdentifier() == CryptoAlgorithmIdentifier::RSA_PSS) {
                        JSC::throwTypeError(globalObject, scope, "ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE: encryption is not supported for jwk format"_s);
                        return {};
                    }
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
                                return {};
                            }
                        } else if (type == "spki"_s) {
                            if (PEM_write_bio_PUBKEY(bio, rsaKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
                            BIO_free(bio);
                            return {};
                        }

                    } else if (string == "der"_s) {
                        if (type == "pkcs1"_s) {
                            if (i2d_RSAPublicKey_bio(bio, rsa_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else if (type == "spki"_s) {
                            if (i2d_PUBKEY_bio(bio, rsaKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'spki'"_s);
                            BIO_free(bio);
                            return {};
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        return {};
                    }
                } else {
                    JSValue cipherJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                    const EVP_CIPHER* cipher = nullptr;
                    if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty() && cipherJSValue.isString()) {
                        auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        if (!cipher_wtfstr.isNull()) {
                            auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                            if (!cipherOrError.has_value()) {
                                JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                BIO_free(bio);
                                return {};
                            } else {
                                auto value = cipherOrError.value();
                                auto cipher_str = value.data();
                                if (cipher_str != nullptr) {
                                    cipher = EVP_get_cipherbyname(cipher_str);
                                }
                            }
                        }
                    }
                    if (passphrase.hasPassphrase()) {
                        if (!cipher) {
                            JSC::throwTypeError(globalObject, scope, "cipher is required when passphrase is specified"_s);
                            BIO_free(bio);
                            return {};
                        }
                    }

                    if (string == "pem"_s) {
                        if (type == "pkcs1"_s) {
                            if (PEM_write_bio_RSAPrivateKey(bio, rsa_ptr, cipher, (unsigned char*)passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else if (type == "pkcs8"_s) {
                            if (PEM_write_bio_PKCS8PrivateKey(bio, rsaKey, cipher, passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return {};
                        }
                    } else if (string == "der"_s) {
                        if (type == "pkcs1"_s) {
                            if (i2d_RSAPrivateKey_bio(bio, rsa_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else if (type == "pkcs8"_s) {
                            if (i2d_PKCS8PrivateKey_bio(bio, rsaKey, cipher, passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return {};
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        return {};
                    }
                }

                BUF_MEM* bptr = nullptr;
                BIO_get_mem_ptr(bio, &bptr);
                auto length = bptr->length;
                if (string == "pem"_s) {
                    auto str = WTF::String::fromUTF8(std::span { bptr->data, length });
                    return JSValue::encode(JSC::jsString(vm, str));
                }

                auto* buffer = createBuffer(globalObject, bptr->data, length);

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
                        return {};
                    }
                    type = typeJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
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
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            return {};
                        }

                    } else if (string == "der"_s) {
                        if (type == "spki"_s) {
                            if (i2d_PUBKEY_bio(bio, ecKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            return {};
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        return {};
                    }
                } else {
                    JSValue cipherJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                    const EVP_CIPHER* cipher = nullptr;
                    if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty()) {
                        auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        if (!cipher_wtfstr.isNull()) {
                            auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                            if (!cipherOrError.has_value()) {
                                JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                BIO_free(bio);
                                return {};
                            } else {
                                auto value = cipherOrError.value();
                                auto cipher_str = value.data();
                                if (cipher_str != nullptr) {
                                    cipher = EVP_get_cipherbyname(cipher_str);
                                }
                            }
                        }
                    }

                    if (passphrase.hasPassphrase()) {

                        if (!cipher) {
                            JSC::throwTypeError(globalObject, scope, "cipher is required when passphrase is specified"_s);
                            BIO_free(bio);
                            return {};
                        }
                    }

                    if (string == "pem"_s) {
                        if (type == "sec1"_s) {
                            if (PEM_write_bio_ECPrivateKey(bio, ec_ptr, cipher, (unsigned char*)passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else if (type == "pkcs8"_s) {
                            if (PEM_write_bio_PKCS8PrivateKey(bio, ecKey, cipher, passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'sec1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return {};
                        }
                    } else if (string == "der"_s) {
                        if (type == "sec1"_s) {
                            if (i2d_ECPrivateKey_bio(bio, ec_ptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else if (type == "pkcs8"_s) {
                            if (i2d_PKCS8PrivateKey_bio(bio, ecKey, cipher, passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'sec1' or 'pkcs8'"_s);
                            BIO_free(bio);
                            return {};
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        return {};
                    }
                }

                BUF_MEM* bptr = nullptr;
                BIO_get_mem_ptr(bio, &bptr);
                auto length = bptr->length;
                if (string == "pem"_s) {
                    auto str = WTF::String::fromUTF8(std::span { bptr->data, length });
                    return JSValue::encode(JSC::jsString(vm, str));
                }

                auto* buffer = createBuffer(globalObject, bptr->data, length);

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
                        return {};
                    }
                    type = typeJSValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                }

                auto keyData = okpKey.exportKey();
                auto* bio = BIO_new(BIO_s_mem());

                EVP_PKEY* evpKey;
                // TODO: CHECK THIS WHEN X488 AND ED448 ARE ADDED
                if (okpKey.type() == CryptoKeyType::Private) {
                    evpKey = EVP_PKEY_new_raw_private_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
                    JSValue cipherJSValue = options->getIfPropertyExists(globalObject, PropertyName(Identifier::fromString(vm, "cipher"_s)));

                    const EVP_CIPHER* cipher = nullptr;
                    if (!cipherJSValue.isUndefinedOrNull() && !cipherJSValue.isEmpty() && cipherJSValue.isString()) {
                        auto cipher_wtfstr = cipherJSValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        if (!cipher_wtfstr.isNull()) {
                            auto cipherOrError = cipher_wtfstr.tryGetUTF8();
                            if (!cipherOrError.has_value()) {
                                JSC::throwTypeError(globalObject, scope, "invalid cipher name"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return {};
                            } else {
                                auto value = cipherOrError.value();
                                auto cipher_str = value.data();
                                if (cipher_str != nullptr) {
                                    cipher = EVP_get_cipherbyname(cipher_str);
                                }
                            }
                        }
                    }

                    if (passphrase.hasPassphrase()) {
                        if (!cipher) {
                            JSC::throwTypeError(globalObject, scope, "cipher is required when passphrase is specified"_s);
                            BIO_free(bio);
                            return {};
                        }
                    }

                    if (string == "pem"_s) {
                        if (type == "pkcs8"_s) {
                            if (PEM_write_bio_PKCS8PrivateKey(bio, evpKey, cipher, passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs8'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return {};
                        }
                    } else if (string == "der"_s) {
                        if (type == "pkcs8"_s) {
                            if (i2d_PKCS8PrivateKey_bio(bio, evpKey, cipher, passphrase.data(), passphrase.length(), nullptr, nullptr) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write private key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'pkcs8'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return {};
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        EVP_PKEY_free(evpKey);
                        return {};
                    }
                } else {
                    evpKey = EVP_PKEY_new_raw_public_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
                    if (string == "pem"_s) {
                        if (type == "spki"_s) {
                            if (PEM_write_bio_PUBKEY(bio, evpKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return {};
                        }

                    } else if (string == "der"_s) {
                        if (type == "spki"_s) {
                            if (i2d_PUBKEY_bio(bio, evpKey) != 1) {
                                JSC::throwTypeError(globalObject, scope, "Failed to write public key"_s);
                                BIO_free(bio);
                                EVP_PKEY_free(evpKey);
                                return {};
                            }
                        } else {
                            JSC::throwTypeError(globalObject, scope, "type should be 'spki'"_s);
                            BIO_free(bio);
                            EVP_PKEY_free(evpKey);
                            return {};
                        }
                    } else {
                        JSC::throwTypeError(globalObject, scope, "format expected to be 'der', 'pem' or 'jwk'"_s);
                        BIO_free(bio);
                        EVP_PKEY_free(evpKey);
                        return {};
                    }
                }

                BUF_MEM* bptr = nullptr;
                BIO_get_mem_ptr(bio, &bptr);
                auto length = bptr->length;
                if (string == "pem"_s) {
                    auto str = WTF::String::fromUTF8(std::span { bptr->data, length });
                    EVP_PKEY_free(evpKey);
                    return JSValue::encode(JSC::jsString(vm, str));
                }

                auto* buffer = WebCore::createBuffer(globalObject, std::span { bptr->data, length });

                BIO_free(bio);
                EVP_PKEY_free(evpKey);
                return JSC::JSValue::encode(buffer);
            }
        }
        case CryptoKeyClass::Raw: {
            const auto& raw = downcast<WebCore::CryptoKeyRaw>(wrapped);
            if (string == "buffer"_s) {
                auto keyData = raw.key();
                return JSC::JSValue::encode(WebCore::createBuffer(globalObject, keyData));
            }

            JSC::throwTypeError(globalObject, scope, "format is expected to be 'buffer'"_s);
            return {};
        }
        default: {
            JSC::throwTypeError(globalObject, scope, "Invalid Operation"_s);
            return {};
        }
        }
        JSC::throwTypeError(globalObject, scope, "format is expected to be 'buffer' or 'jwk'"_s);
        return {};
    } else {
        JSC::throwTypeError(globalObject, scope, "expected options to be a object"_s);
        return {};
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

JSC_DEFINE_HOST_FUNCTION(KeyObject_AsymmetricKeyDetails, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        auto id = key->wrapped().algorithmIdentifier();
        auto& vm = JSC::getVM(lexicalGlobalObject);
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
                            return {};
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
        case CryptoAlgorithmIdentifier::X25519:
        case CryptoAlgorithmIdentifier::Ed25519: {
            auto* obj = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 1);
            auto& wrapped = key->wrapped();
            const auto& okp = downcast<WebCore::CryptoKeyOKP>(wrapped);
            auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
            auto& commonStrings = globalObject->commonStrings();
            JSString* namedCurveString = okp.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? commonStrings.x25519String(lexicalGlobalObject) : commonStrings.ed25519String(lexicalGlobalObject);
            obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "namedCurve"_s)), namedCurveString, 0);
            return JSC::JSValue::encode(obj);
        }
        default:
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__generateKeyPairSync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count < 1) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "generateKeyPairSync requires 1 arguments"_s);
        return {};
    }

    auto type = callFrame->argument(0);
    if (type.isUndefinedOrNull() || type.isEmpty() || !type.isString()) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "type is expected to be a string"_s);
        return {};
    }
    auto type_str = type.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* structure = zigGlobalObject->JSCryptoKeyStructure();
    if (type_str == "rsa"_s) {
        if (count == 1) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.modulusLength are required for rsa"_s);
            return {};
        }
        auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1));
        if (options == nullptr) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options is expected to be a object"_s);
            return {};
        }
        auto modulusLengthJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "modulusLength"_s)));
        if (!modulusLengthJS.isNumber()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.modulusLength is expected to be a number"_s);
            return {};
        }
        auto publicExponentJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "publicExponent"_s)));
        uint32_t publicExponent = 0x10001;
        if (publicExponentJS.isNumber()) {
            publicExponent = publicExponentJS.toUInt32(lexicalGlobalObject);
        } else if (!publicExponentJS.isUndefinedOrNull() && !publicExponentJS.isEmpty()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.publicExponent is expected to be a number"_s);
            return {};
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
            // TODO: include what error was thrown in the message
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Failed to generate key pair"_s));
        };
        // this is actually sync
        CryptoKeyRSA::generatePair(CryptoAlgorithmIdentifier::RSA_OAEP, CryptoAlgorithmIdentifier::SHA_1, false, modulusLength, Vector<uint8_t>(std::span { (uint8_t*)&publicExponentArray, 4 }), true, CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt, WTFMove(keyPairCallback), WTFMove(failureCallback), zigGlobalObject->scriptExecutionContext());
        return JSValue::encode(returnValue);
    }
    if (type_str == "rsa-pss"_s) {
        if (count == 1) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.modulusLength are required for rsa"_s);
            return {};
        }
        auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1));
        if (options == nullptr) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options is expected to be a object"_s);
            return {};
        }
        auto modulusLengthJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "modulusLength"_s)));
        if (!modulusLengthJS.isNumber()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.modulusLength is expected to be a number"_s);
            return {};
        }
        auto publicExponentJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "publicExponent"_s)));
        uint32_t publicExponent = 0x10001;
        if (publicExponentJS.isNumber()) {
            publicExponent = publicExponentJS.toUInt32(lexicalGlobalObject);
        } else if (!publicExponentJS.isUndefinedOrNull() && !publicExponentJS.isEmpty()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.publicExponent is expected to be a number"_s);
            return {};
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

        auto hashAlgoJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "hashAlgorithm"_s)));
        auto hasHash = false;
        auto hash = CryptoAlgorithmIdentifier::SHA_1;
        if (!hashAlgoJS.isUndefinedOrNull() && !hashAlgoJS.isEmpty()) {
            if (!hashAlgoJS.isString()) {
                JSC::throwTypeError(lexicalGlobalObject, scope, "options.hashAlgorithm is expected to be a string"_s);
                return {};
            }
            hasHash = true;
            auto hashAlgo = hashAlgoJS.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});

            auto identifier = CryptoAlgorithmRegistry::singleton().identifier(hashAlgo);
            if (UNLIKELY(!identifier)) {
                JSC::throwTypeError(lexicalGlobalObject, scope, "options.hashAlgorithm is invalid"_s);
                return {};
            }

            switch (*identifier) {
            case WebCore::CryptoAlgorithmIdentifier::SHA_1:
            case WebCore::CryptoAlgorithmIdentifier::SHA_224:
            case WebCore::CryptoAlgorithmIdentifier::SHA_256:
            case WebCore::CryptoAlgorithmIdentifier::SHA_384:
            case WebCore::CryptoAlgorithmIdentifier::SHA_512: {

                hash = *identifier;
                break;
            }
            default: {
                JSC::throwTypeError(lexicalGlobalObject, scope, "options.hashAlgorithm is invalid"_s);
                return {};
            }
            }
        }

        // TODO: @cirospaciari is saltLength supposed to be used here?
        // auto saltLengthJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "hashAlgorithm"_s)));

        auto failureCallback = [&]() {
            // TODO: include what error was thrown in the message
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Failed to generate key pair"_s));
        };
        // this is actually sync
        CryptoKeyRSA::generatePair(CryptoAlgorithmIdentifier::RSA_PSS, hash, hasHash, modulusLength, Vector<uint8_t>(std::span { (uint8_t*)&publicExponentArray, 4 }), true, CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt, WTFMove(keyPairCallback), WTFMove(failureCallback), zigGlobalObject->scriptExecutionContext());
        return JSValue::encode(returnValue);
    } else if (type_str == "ec"_s) {
        if (count == 1) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options.namedCurve is required for ec"_s);
            return {};
        }
        auto* options = jsDynamicCast<JSC::JSObject*>(callFrame->argument(1));
        if (options == nullptr) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "options is expected to be a object"_s);
            return {};
        }
        auto namedCurveJS = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "namedCurve"_s)));
        if (namedCurveJS.isUndefinedOrNull() || namedCurveJS.isEmpty() || !namedCurveJS.isString()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "namedCurve is expected to be a string"_s);
            return {};
        }
        auto namedCurve = namedCurveJS.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (namedCurve == "P-384"_s || namedCurve == "p384"_s || namedCurve == "secp384r1"_s) {
            namedCurve = "P-384"_s;
        } else if (namedCurve == "P-256"_s || namedCurve == "p256"_s || namedCurve == "prime256v1"_s) {
            namedCurve = "P-256"_s;
        } else if (namedCurve == "P-521"_s || namedCurve == "p521"_s || namedCurve == "secp521r1"_s) {
            namedCurve = "P-521"_s;
        } else {
            return Bun::ERR::CRYPTO_JWK_UNSUPPORTED_CURVE(scope, lexicalGlobalObject, namedCurve);
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
        auto result = CryptoKeyOKP::generatePair(CryptoAlgorithmIdentifier::X25519, CryptoKeyOKP::NamedCurve::X25519, true, CryptoKeyUsageDeriveKey | CryptoKeyUsageDeriveBits | CryptoKeyUsageSign | CryptoKeyUsageVerify);
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
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "algorithm should be 'rsa', 'rsa-pss', 'ec', 'x25519' or 'ed25519'"_s));
        return {};
    }
    return JSValue::encode(JSC::jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(KeyObject__generateKeySync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (count < 2) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "generateKeySync requires 2 arguments"_s);
        return {};
    }

    auto type = callFrame->argument(0);
    if (type.isUndefinedOrNull() || type.isEmpty() || !type.isString()) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "type is expected to be a string"_s);
        return {};
    }

    auto type_str = type.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (type_str == "hmac"_s) {
        Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        auto* structure = zigGlobalObject->JSCryptoKeyStructure();
        size_t lengthBits = 0;
        auto length = callFrame->argument(1);
        if (!length.isNumber()) {
            JSC::throwTypeError(lexicalGlobalObject, scope, "length is expected to be a number"_s);
            return {};
        }
        lengthBits = length.toUInt32(lexicalGlobalObject);
        auto result = CryptoKeyHMAC::generate(lengthBits, WebCore::CryptoAlgorithmIdentifier::HMAC, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (UNLIKELY(result == nullptr)) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Invalid length"_s));
            return {};
        }
        return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, result.releaseNonNull()));
    } else if (type_str == "aes"_s) {
        Zig::GlobalObject* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        auto* structure = zigGlobalObject->JSCryptoKeyStructure();
        size_t lengthBits = 0;
        if (count > 1) {
            auto length = callFrame->argument(1);
            if (!length.isNumber()) {
                JSC::throwTypeError(lexicalGlobalObject, scope, "length is expected to be a number"_s);
                return {};
            }
            lengthBits = length.toUInt32(lexicalGlobalObject);
        }

        auto result = CryptoKeyAES::generate(WebCore::CryptoAlgorithmIdentifier::AES_CBC, lengthBits, true, CryptoKeyUsageSign | CryptoKeyUsageVerify);
        if (UNLIKELY(result == nullptr)) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Invalid length"_s));
            return {};
        }
        return JSC::JSValue::encode(JSCryptoKey::create(structure, zigGlobalObject, result.releaseNonNull()));
    } else {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "algorithm should be 'aes' or 'hmac'"_s));
        return {};
    }
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__AsymmetricKeyType, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    // TODO: Look into DSA and DH
    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        auto id = key->wrapped().algorithmIdentifier();
        switch (id) {
        case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
            return JSC::JSValue::encode(commonStrings.rsaString(globalObject));
        case CryptoAlgorithmIdentifier::RSA_PSS:
            return JSC::JSValue::encode(commonStrings.rsaPssString(globalObject));
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
            return JSC::JSValue::encode(commonStrings.ecString(globalObject));
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519: {
            const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(key->wrapped());
            return JSC::JSValue::encode(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? commonStrings.x25519String(globalObject) : commonStrings.ed25519String(globalObject));
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
AsymmetricKeyValue::~AsymmetricKeyValue()
{
    if (key && owned) {
        EVP_PKEY_free(key);
    }
}

AsymmetricKeyValue::AsymmetricKeyValue(WebCore::CryptoKey& cryptoKey)
{
    auto id = cryptoKey.algorithmIdentifier();
    owned = false;
    key = nullptr;

    switch (id) {
    case CryptoAlgorithmIdentifier::RSAES_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
    case CryptoAlgorithmIdentifier::RSA_OAEP:
    case CryptoAlgorithmIdentifier::RSA_PSS:
        key = downcast<WebCore::CryptoKeyRSA>(cryptoKey).platformKey();
        break;
    case CryptoAlgorithmIdentifier::ECDSA:
    case CryptoAlgorithmIdentifier::ECDH:
        key = downcast<WebCore::CryptoKeyEC>(cryptoKey).platformKey();
        break;
    case CryptoAlgorithmIdentifier::X25519:
    case CryptoAlgorithmIdentifier::Ed25519: {
        const auto& okpKey = downcast<WebCore::CryptoKeyOKP>(cryptoKey);
        auto keyData = okpKey.exportKey();
        if (okpKey.type() == CryptoKeyType::Private) {
            key = EVP_PKEY_new_raw_private_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
            owned = true;
            break;
        } else {
            auto* evp_key = EVP_PKEY_new_raw_public_key(okpKey.namedCurve() == CryptoKeyOKP::NamedCurve::X25519 ? EVP_PKEY_X25519 : EVP_PKEY_ED25519, nullptr, keyData.data(), keyData.size());
            key = evp_key;
            owned = true;
            break;
        }
    }
    case CryptoAlgorithmIdentifier::AES_CTR:
    case CryptoAlgorithmIdentifier::AES_CBC:
    case CryptoAlgorithmIdentifier::AES_GCM:
    case CryptoAlgorithmIdentifier::AES_CFB:
    case CryptoAlgorithmIdentifier::AES_KW:
    case CryptoAlgorithmIdentifier::HMAC:
    case CryptoAlgorithmIdentifier::SHA_1:
    case CryptoAlgorithmIdentifier::SHA_224:
    case CryptoAlgorithmIdentifier::SHA_256:
    case CryptoAlgorithmIdentifier::SHA_384:
    case CryptoAlgorithmIdentifier::SHA_512:
    case CryptoAlgorithmIdentifier::HKDF:
    case CryptoAlgorithmIdentifier::PBKDF2:
    case CryptoAlgorithmIdentifier::None:
        key = nullptr;
        break;
    }
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__Equals, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;
    if (auto* key = jsDynamicCast<JSCryptoKey*>(callFrame->argument(0))) {
        if (auto* key2 = jsDynamicCast<JSCryptoKey*>(callFrame->argument(1))) {
            auto& wrapped = key->wrapped();
            auto& wrapped2 = key2->wrapped();
            auto key_type = wrapped.type();
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
            AsymmetricKeyValue first(wrapped);
            AsymmetricKeyValue second(wrapped2);

            int ok = !first.key || !second.key ? -2 : EVP_PKEY_cmp(first.key, second.key);

            if (ok == -2) {
                auto& vm = JSC::getVM(lexicalGlobalObject);
                auto scope = DECLARE_THROW_SCOPE(vm);
                throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "ERR_CRYPTO_UNSUPPORTED_OPERATION"_s));
                return {};
            }
            return JSC::JSValue::encode(jsBoolean(ok == 1));
        }
    }
    return JSC::JSValue::encode(jsBoolean(false));
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__SymmetricKeySize, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

static EncodedJSValue doAsymmetricCipher(JSGlobalObject* globalObject, CallFrame* callFrame, bool encrypt)
{
    auto count = callFrame->argumentCount();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (count != 2) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_MISSING_ARGS,
            "expected object as first argument"_s);
    }

    auto* jsKey = jsDynamicCast<JSObject*>(callFrame->uncheckedArgument(0));
    if (!jsKey) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "expected object as first argument"_s);
    }

    auto jsCryptoKeyValue = jsKey->getIfPropertyExists(
        globalObject, PropertyName(Identifier::fromString(vm, "key"_s)));
    if (jsCryptoKeyValue.isUndefinedOrNull() || jsCryptoKeyValue.isEmpty()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "expected key property in key object"_s);
    }
    auto* jsCryptoKey = jsDynamicCast<JSCryptoKey*>(jsCryptoKeyValue);

    auto& cryptoKey = jsCryptoKey->wrapped();
    // We should only encrypt to public keys, and decrypt with private keys.
    if ((encrypt && cryptoKey.type() != CryptoKeyType::Public)
        || (!encrypt && cryptoKey.type() != CryptoKeyType::Private)
        // RSA-OAEP is the modern alternative to RSAES-PKCS1-v1_5, which is vulnerable to
        // known-ciphertext attacks. Node.js does not support it either.
        || cryptoKey.algorithmIdentifier() != CryptoAlgorithmIdentifier::RSA_OAEP) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_VALUE,
            "unsupported key type for asymmetric encryption"_s);
    }

    bool setCustomHash = false;
    auto oaepHash = WebCore::CryptoAlgorithmIdentifier::SHA_1;
    auto jsOaepHash = jsKey->getIfPropertyExists(
        globalObject, PropertyName(Identifier::fromString(vm, "oaepHash"_s)));
    if (!jsOaepHash.isUndefined() && !jsOaepHash.isEmpty()) {
        if (UNLIKELY(!jsOaepHash.isString())) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
                "expected string for oaepHash"_s);
        }
        auto oaepHashStr = jsOaepHash.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto oaepHashId = CryptoAlgorithmRegistry::singleton().identifier(oaepHashStr);
        if (UNLIKELY(!oaepHashId)) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_CRYPTO_INVALID_DIGEST,
                "unsupported digest for oaepHash"_s);
        }
        switch (*oaepHashId) {
        case WebCore::CryptoAlgorithmIdentifier::SHA_1:
        case WebCore::CryptoAlgorithmIdentifier::SHA_224:
        case WebCore::CryptoAlgorithmIdentifier::SHA_256:
        case WebCore::CryptoAlgorithmIdentifier::SHA_384:
        case WebCore::CryptoAlgorithmIdentifier::SHA_512: {
            setCustomHash = true;
            oaepHash = *oaepHashId;
            break;
        }
        default: {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_CRYPTO_INVALID_DIGEST,
                "unsupported digest for oaepHash"_s);
        }
        }
    }

    std::optional<BufferSource::VariantType> oaepLabel = std::nullopt;
    auto jsOaepLabel = jsKey->getIfPropertyExists(
        globalObject, PropertyName(Identifier::fromString(vm, "oaepLabel"_s)));
    if (!jsOaepLabel.isUndefined() && !jsOaepLabel.isEmpty()) {
        if (UNLIKELY(!jsOaepLabel.isCell())) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
                "expected Buffer or array-like object for oaepLabel"_s);
        }
        auto jsOaepLabelCell = jsOaepLabel.asCell();
        auto jsOaepLabelType = jsOaepLabelCell->type();

        if (isTypedArrayTypeIncludingDataView(jsOaepLabelType)) {
            auto* jsBufferView = jsCast<JSArrayBufferView*>(jsOaepLabelCell);
            oaepLabel = std::optional<BufferSource::VariantType> { jsBufferView->unsharedImpl() };
        } else if (jsOaepLabelType == ArrayBufferType) {
            auto* jsBuffer = jsDynamicCast<JSArrayBuffer*>(jsOaepLabelCell);
            oaepLabel = std::optional<BufferSource::VariantType> { jsBuffer->impl() };
        } else {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
                "expected Buffer or array-like object for oaepLabel"_s);
        }
    }

    auto padding = RSA_PKCS1_OAEP_PADDING;
    auto jsPadding = jsKey->getIfPropertyExists(
        globalObject, PropertyName(Identifier::fromString(vm, "padding"_s)));
    if (!jsPadding.isUndefinedOrNull() && !jsPadding.isEmpty()) {
        if (UNLIKELY(!jsPadding.isNumber())) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
                "expected number for padding"_s);
        }
        padding = jsPadding.toUInt32(globalObject);
        if (padding == RSA_PKCS1_PADDING && !encrypt) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_VALUE,
                "RSA_PKCS1_PADDING is no longer supported for private decryption"_s);
        }
        if (padding != RSA_PKCS1_OAEP_PADDING && (setCustomHash || oaepLabel.has_value())) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_VALUE,
                "oaepHash/oaepLabel cannot be set without RSA_PKCS1_OAEP_PADDING"_s);
        }
    }

    auto jsBuffer = KeyObject__GetBuffer(callFrame->uncheckedArgument(1));
    if (jsBuffer.hasException()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "expected Buffer or array-like object as second argument"_s);
    }
    auto buffer = jsBuffer.releaseReturnValue();

    auto params = CryptoAlgorithmRsaOaepParams {};
    params.label = oaepLabel;
    params.padding = padding;
    const auto& rsaKey = downcast<CryptoKeyRSA>(cryptoKey);
    auto operation = encrypt ? CryptoAlgorithmRSA_OAEP::platformEncryptWithHash : CryptoAlgorithmRSA_OAEP::platformDecryptWithHash;
    auto result = operation(params, rsaKey, buffer, oaepHash);
    if (result.hasException()) {
        WebCore::propagateException(*globalObject, scope, result.releaseException());
        return encodedJSUndefined();
    }
    auto outBuffer = result.releaseReturnValue();
    return JSValue::encode(WebCore::createBuffer(globalObject, outBuffer));
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__publicEncrypt, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return doAsymmetricCipher(globalObject, callFrame, true);
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__privateDecrypt, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return doAsymmetricCipher(globalObject, callFrame, false);
}

static EncodedJSValue doAsymmetricSign(JSGlobalObject* globalObject, CallFrame* callFrame, bool encrypt)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() != 3) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_MISSING_ARGS,
            "expected three arguments"_s);
    }

    auto* jsCryptoKey = jsDynamicCast<JSCryptoKey*>(callFrame->uncheckedArgument(0));
    if (!jsCryptoKey) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "expected CryptoKey as first argument"_s);
    }
    auto& cryptoKey = jsCryptoKey->wrapped();

    // We should only sign with private keys, and verify with public keys.
    if ((encrypt && cryptoKey.type() != CryptoKeyType::Private)
        || (!encrypt && cryptoKey.type() != CryptoKeyType::Public)
        // We may classify the key as RSA_OAEP, but it can still be used for signing. RSA_PSS relies
        // on an incompatible scheme, and must be used via the generic crypto.sign function.
        || (cryptoKey.algorithmIdentifier() != CryptoAlgorithmIdentifier::RSA_OAEP
            && cryptoKey.algorithmIdentifier() != CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5)) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_VALUE,
            "unsupported key type for asymmetric signing"_s);
    }

    auto jsBuffer = KeyObject__GetBuffer(callFrame->uncheckedArgument(1));
    if (jsBuffer.hasException()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "expected Buffer or array-like object as second argument"_s);
    }
    auto buffer = jsBuffer.releaseReturnValue();

    auto padding = RSA_PKCS1_PADDING;
    auto jsPadding = callFrame->uncheckedArgument(2);
    if (!jsPadding.isUndefinedOrNull() && !jsPadding.isEmpty()) {
        if (UNLIKELY(!jsPadding.isNumber())) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
                "expected number for padding"_s);
        }
        padding = jsPadding.toUInt32(globalObject);
        if (padding != RSA_PKCS1_PADDING && padding != RSA_NO_PADDING) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_VALUE,
                "unsupported padding"_s);
        }
    }

    const auto& rsaKey = downcast<CryptoKeyRSA>(cryptoKey);
    auto operation = encrypt ? CryptoAlgorithmRSASSA_PKCS1_v1_5::platformSignNoAlgorithm
                             : CryptoAlgorithmRSASSA_PKCS1_v1_5::platformVerifyRecover;
    auto result = operation(rsaKey, padding, buffer);
    if (result.hasException()) {
        WebCore::propagateException(*globalObject, scope, result.releaseException());
        return encodedJSUndefined();
    }
    auto outBuffer = result.releaseReturnValue();
    return JSValue::encode(WebCore::createBuffer(globalObject, outBuffer));
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__privateEncrypt, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return doAsymmetricSign(globalObject, callFrame, true);
}

JSC_DEFINE_HOST_FUNCTION(KeyObject__publicDecrypt, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return doAsymmetricSign(globalObject, callFrame, false);
}

JSValue createKeyObjectBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "symmetricKeySize"_s)), JSC::JSFunction::create(vm, globalObject, 1, "symmetricKeySize"_s, KeyObject__SymmetricKeySize, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "asymmetricKeyType"_s)), JSC::JSFunction::create(vm, globalObject, 1, "asymmetricKeyType"_s, KeyObject__AsymmetricKeyType, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "asymmetricKeyDetails"_s)), JSC::JSFunction::create(vm, globalObject, 1, "asymmetricKeyDetails"_s, KeyObject_AsymmetricKeyDetails, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "equals"_s)), JSC::JSFunction::create(vm, globalObject, 2, "equals"_s, KeyObject__Equals, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "exports"_s)), JSC::JSFunction::create(vm, globalObject, 2, "exports"_s, KeyObject__Exports, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createSecretKey"_s)), JSC::JSFunction::create(vm, globalObject, 1, "createSecretKey"_s, KeyObject__createSecretKey, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createPublicKey"_s)), JSC::JSFunction::create(vm, globalObject, 1, "createPublicKey"_s, KeyObject__createPublicKey, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createPrivateKey"_s)), JSC::JSFunction::create(vm, globalObject, 1, "createPrivateKey"_s, KeyObject__createPrivateKey, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "generateKeySync"_s)), JSC::JSFunction::create(vm, globalObject, 2, "generateKeySync"_s, KeyObject__generateKeySync, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "generateKeyPairSync"_s)), JSC::JSFunction::create(vm, globalObject, 2, "generateKeyPairSync"_s, KeyObject__generateKeyPairSync, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "sign"_s)), JSC::JSFunction::create(vm, globalObject, 3, "sign"_s, KeyObject__Sign, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "verify"_s)), JSC::JSFunction::create(vm, globalObject, 4, "verify"_s, KeyObject__Verify, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "publicEncrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "publicEncrypt"_s, KeyObject__publicEncrypt, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "privateDecrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "privateDecrypt"_s, KeyObject__privateDecrypt, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "privateEncrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "privateEncrypt"_s, KeyObject__privateEncrypt, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "publicDecrypt"_s)),
        JSFunction::create(vm, globalObject, 2, "publicDecrypt"_s, KeyObject__publicDecrypt, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "X509Certificate"_s)),
        globalObject->m_JSX509CertificateClassStructure.constructor(globalObject));
    return obj;
}

} // namespace WebCore
