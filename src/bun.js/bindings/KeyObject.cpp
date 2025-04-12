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

namespace WebCore {

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

ExceptionOr<std::span<const uint8_t>> KeyObject__GetBuffer(JSValue bufferArg)
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
        if (view->isDetached()) {
            break;
        }
        return view->span();
    }
    case ArrayBufferType: {
        auto* jsBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(bufferArgCell);
        if (UNLIKELY(!jsBuffer)) {
            break;
        }
        auto* buffer = jsBuffer->impl();
        if (buffer->isDetached()) {
            break;
        }
        return buffer->span();
    }
    default: {
        break;
    }
    }
    return Exception { OperationError };
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

std::optional<std::span<const uint8_t>> getSymmetricKey(const WebCore::CryptoKey& key)
{
    auto id = key.keyClass();
    switch (id) {
    case CryptoKeyClass::HMAC: {
        const auto& hmac = downcast<WebCore::CryptoKeyHMAC>(key);
        return hmac.key().span();
    }
    case CryptoKeyClass::AES: {
        const auto& aes = downcast<WebCore::CryptoKeyAES>(key);
        return aes.key().span();
    }
    case CryptoKeyClass::Raw: {
        const auto& raw = downcast<WebCore::CryptoKeyRaw>(key);
        return raw.key().span();
    }
    default: {
        return std::nullopt;
    }
    }
}

} // namespace WebCore
