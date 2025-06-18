#include "KeyObject.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"
#include "helpers.h"
#include "ZigGlobalObject.h"
#include "CryptoUtil.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "AsymmetricKeyValue.h"
#include "CryptoKeyAES.h"
#include "CryptoKeyHMAC.h"
#include "CryptoKeyRaw.h"
#include "CryptoKey.h"
#include "CryptoKeyType.h"
#include "JSCryptoKey.h"
#include "CryptoGenKeyPair.h"
#include "JSBuffer.h"
#include "BunString.h"

namespace Bun {

using namespace Bun;
using namespace JSC;
using namespace ncrypto;
using namespace WebCore;

JSValue encodeBignum(JSGlobalObject* globalObject, ThrowScope& scope, const BIGNUM* bn, int size)
{
    auto buf = ncrypto::BignumPointer::EncodePadded(bn, size);

    JSValue encoded = JSValue::decode(StringBytes::encode(globalObject, scope, buf.span(), BufferEncodingType::base64url));
    RETURN_IF_EXCEPTION(scope, {});

    return encoded;
}

void setEncodedValue(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* obj, JSString* name, const BIGNUM* bn, int size = 0)
{
    if (size == 0) {
        size = ncrypto::BignumPointer::GetByteCount(bn);
    }

    VM& vm = globalObject->vm();
    JSValue encodedBn = encodeBignum(globalObject, scope, bn, size);
    RETURN_IF_EXCEPTION(scope, );

    obj->putDirect(vm, Identifier::fromString(vm, name->value(globalObject)), encodedBn);
}

JSC::JSValue KeyObject::exportJwkEdKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, CryptoKeyType exportType)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    const auto& pkey = m_data->asymmetricKey;

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    ASCIILiteral curve = ([&] {
        switch (pkey.id()) {
        case EVP_PKEY_ED25519:
            return "Ed25519"_s;
        case EVP_PKEY_ED448:
            return "Ed448"_s;
        case EVP_PKEY_X25519:
            return "X25519"_s;
        case EVP_PKEY_X448:
            return "X448"_s;
        default:
            UNREACHABLE();
        }
    })();

    jwk->putDirect(
        vm,
        Identifier::fromString(vm, commonStrings.jwkCrvString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        jsString(vm, makeString(curve)));

    if (exportType == CryptoKeyType::Private) {
        ncrypto::DataPointer privateData = pkey.rawPrivateKey();

        JSValue encoded = JSValue::decode(StringBytes::encode(lexicalGlobalObject, scope, privateData.span(), BufferEncodingType::base64url));
        RETURN_IF_EXCEPTION(scope, {});
        jwk->putDirect(
            vm,
            Identifier::fromString(vm, commonStrings.jwkDString(lexicalGlobalObject)->value(lexicalGlobalObject)),
            encoded);
    }

    ncrypto::DataPointer publicData = pkey.rawPublicKey();
    JSValue encoded = JSValue::decode(StringBytes::encode(lexicalGlobalObject, scope, publicData.span(), BufferEncodingType::base64url));
    RETURN_IF_EXCEPTION(scope, {});
    jwk->putDirect(
        vm,
        Identifier::fromString(vm, commonStrings.jwkXString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        encoded);

    jwk->putDirect(
        vm,
        Identifier::fromString(vm, commonStrings.jwkKtyString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        commonStrings.jwkOkpString(lexicalGlobalObject));

    return jwk;
}

JSC::JSValue KeyObject::exportJwkEcKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, CryptoKeyType exportType)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    const auto& pkey = m_data->asymmetricKey;
    ASSERT(pkey.id() == EVP_PKEY_EC);

    const EC_KEY* ec = pkey;
    ASSERT(ec);

    const auto pub = ncrypto::ECKeyPointer::GetPublicKey(ec);
    const auto group = ncrypto::ECKeyPointer::GetGroup(ec);

    int degree_bits = EC_GROUP_get_degree(group);
    int degree_bytes = (degree_bits / CHAR_BIT) + (7 + (degree_bits % CHAR_BIT)) / 8;

    auto x = ncrypto::BignumPointer::New();
    auto y = ncrypto::BignumPointer::New();

    if (!EC_POINT_get_affine_coordinates(group, pub, x.get(), y.get(), nullptr)) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(),
            "Failed to get elliptic-curve point coordinates");
        return {};
    }

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    jwk->putDirect(
        vm,
        Identifier::fromString(vm, commonStrings.jwkKtyString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        commonStrings.jwkEcString(lexicalGlobalObject));

    setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkXString(lexicalGlobalObject), x.get(), degree_bytes);
    RETURN_IF_EXCEPTION(scope, {});
    setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkYString(lexicalGlobalObject), y.get(), degree_bytes);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::ASCIILiteral crvName;
    const int nid = EC_GROUP_get_curve_name(group);
    switch (nid) {
    case NID_X9_62_prime256v1:
        crvName = "P-256"_s;
        break;
    case NID_secp256k1:
        crvName = "secp256k1"_s;
        break;
    case NID_secp384r1:
        crvName = "P-384"_s;
        break;
    case NID_secp521r1:
        crvName = "P-521"_s;
        break;
    default: {
        ERR::CRYPTO_JWK_UNSUPPORTED_CURVE(scope, lexicalGlobalObject, "Unsupported JWK EC curve: ", OBJ_nid2sn(nid));
        return {};
    }
    }

    jwk->putDirect(
        vm,
        Identifier::fromString(vm, commonStrings.jwkCrvString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        jsString(vm, makeString(crvName)));

    if (exportType == CryptoKeyType::Private) {
        auto pvt = ncrypto::ECKeyPointer::GetPrivateKey(ec);
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkDString(lexicalGlobalObject), pvt, degree_bytes);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return jwk;
}

JSC::JSValue KeyObject::exportJwkRsaKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, CryptoKeyType exportType)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    const auto& pkey = m_data->asymmetricKey;
    const ncrypto::Rsa rsa = pkey;

    auto publicKey = rsa.getPublicKey();

    jwk->putDirect(vm,
        Identifier::fromString(vm, commonStrings.jwkKtyString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        commonStrings.jwkRsaString(lexicalGlobalObject));

    setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkNString(lexicalGlobalObject), publicKey.n);
    RETURN_IF_EXCEPTION(scope, {});
    setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkEString(lexicalGlobalObject), publicKey.e);
    RETURN_IF_EXCEPTION(scope, {});

    if (exportType == CryptoKeyType::Private) {
        auto privateKey = rsa.getPrivateKey();
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkDString(lexicalGlobalObject), publicKey.d);
        RETURN_IF_EXCEPTION(scope, {});
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkPString(lexicalGlobalObject), privateKey.p);
        RETURN_IF_EXCEPTION(scope, {});
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkQString(lexicalGlobalObject), privateKey.q);
        RETURN_IF_EXCEPTION(scope, {});
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkDpString(lexicalGlobalObject), privateKey.dp);
        RETURN_IF_EXCEPTION(scope, {});
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkDqString(lexicalGlobalObject), privateKey.dq);
        RETURN_IF_EXCEPTION(scope, {});
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkQiString(lexicalGlobalObject), privateKey.qi);
    }

    return jwk;
}

JSC::JSValue KeyObject::exportJwkSecretKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope)
{

    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    JSValue encoded = JSValue::decode(StringBytes::encode(lexicalGlobalObject, scope, m_data->symmetricKey, BufferEncodingType::base64url));
    RETURN_IF_EXCEPTION(scope, {});

    jwk->putDirect(vm,
        Identifier::fromString(vm, commonStrings.jwkKtyString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        commonStrings.jwkOctString(lexicalGlobalObject));

    jwk->putDirect(vm,
        Identifier::fromString(vm, commonStrings.jwkKString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        encoded);

    return jwk;
}

JSC::JSValue KeyObject::exportJwkAsymmetricKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, CryptoKeyType exportType, bool handleRsaPss)
{
    switch (m_data->asymmetricKey.id()) {
    case EVP_PKEY_RSA_PSS: {
        if (handleRsaPss) {
            return exportJwkRsaKey(globalObject, scope, exportType);
        }
        break;
    }

    case EVP_PKEY_RSA:
        return exportJwkRsaKey(globalObject, scope, exportType);

    case EVP_PKEY_EC:
        return exportJwkEcKey(globalObject, scope, exportType);

    case EVP_PKEY_ED25519:
    case EVP_PKEY_ED448:
    case EVP_PKEY_X25519:
    case EVP_PKEY_X448:
        return exportJwkEdKey(globalObject, scope, exportType);
    }

    ERR::CRYPTO_JWK_UNSUPPORTED_KEY_TYPE(scope, globalObject);
    return {};
}

JSC::JSValue KeyObject::exportJwk(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, CryptoKeyType type, bool handleRsaPss)
{
    if (type == CryptoKeyType::Secret) {
        return exportJwkSecretKey(globalObject, scope);
    }

    return exportJwkAsymmetricKey(globalObject, scope, type, handleRsaPss);
}

JSValue toJS(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, const ncrypto::BIOPointer& bio, const ncrypto::EVPKeyPointer::AsymmetricKeyEncodingConfig& encodingConfig)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    BUF_MEM* bptr = bio;

    if (encodingConfig.format == ncrypto::EVPKeyPointer::PKFormatType::PEM) {
        WTF::String pem = String::fromUTF8({ bptr->data, bptr->length });
        return jsString(vm, pem);
    }

    ASSERT(encodingConfig.format == ncrypto::EVPKeyPointer::PKFormatType::DER);

    RefPtr<ArrayBuffer> buf = JSC::ArrayBuffer::tryCreateUninitialized(bptr->length, 1);
    if (!buf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }
    memcpy(buf->data(), bptr->data, bptr->length);

    return JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buf), 0, bptr->length);
}

JSC::JSValue KeyObject::exportPublic(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const ncrypto::EVPKeyPointer::PublicKeyEncodingConfig& config)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    ASSERT(type() != CryptoKeyType::Secret);

    if (config.output_key_object) {
        KeyObject keyObject = *this;
        keyObject.type() = CryptoKeyType::Public;
        Structure* structure = globalObject->m_JSPublicKeyObjectClassStructure.get(lexicalGlobalObject);
        JSPublicKeyObject* publicKey = JSPublicKeyObject::create(vm, structure, lexicalGlobalObject, WTFMove(keyObject));
        return publicKey;
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
        return exportJwk(lexicalGlobalObject, scope, CryptoKeyType::Public, false);
    }

    const ncrypto::EVPKeyPointer& pkey = m_data->asymmetricKey;
    auto res = pkey.writePublicKey(config);
    if (!res) {
        throwCryptoError(lexicalGlobalObject, scope, res.openssl_error.value_or(0), "Failed to encode public key");
        return {};
    }

    return toJS(lexicalGlobalObject, scope, res.value, config);
}

JSValue KeyObject::exportPrivate(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, const ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig& config)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    ASSERT(type() != CryptoKeyType::Secret);

    if (config.output_key_object) {
        KeyObject keyObject = *this;
        Structure* structure = globalObject->m_JSPrivateKeyObjectClassStructure.get(lexicalGlobalObject);
        JSPrivateKeyObject* privateKey = JSPrivateKeyObject::create(vm, structure, lexicalGlobalObject, WTFMove(keyObject));
        return privateKey;
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
        return exportJwk(lexicalGlobalObject, scope, CryptoKeyType::Private, false);
    }

    const ncrypto::EVPKeyPointer& pkey = m_data->asymmetricKey;
    auto res = pkey.writePrivateKey(config);
    if (!res) {
        throwCryptoError(lexicalGlobalObject, scope, res.openssl_error.value_or(0), "Failed to encode private key");
        return {};
    }

    return toJS(lexicalGlobalObject, scope, res.value, config);
}

JSValue KeyObject::exportAsymmetric(JSGlobalObject* globalObject, ThrowScope& scope, JSValue optionsValue, CryptoKeyType exportType)
{
    VM& vm = globalObject->vm();

    ASSERT(type() != CryptoKeyType::Secret);

    if (JSObject* options = jsDynamicCast<JSObject*>(optionsValue)) {
        JSValue formatValue = options->get(globalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (formatValue.isString()) {
            auto* formatString = formatValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto formatView = formatString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (formatView == "jwk"_s) {
                if (exportType == CryptoKeyType::Private) {
                    JSValue passphraseValue = options->get(globalObject, Identifier::fromString(vm, "passphrase"_s));
                    RETURN_IF_EXCEPTION(scope, {});
                    if (!passphraseValue.isUndefined()) {
                        ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, "jwk"_s, "does not support encryption"_s);
                        return {};
                    }
                }

                return exportJwk(globalObject, scope, exportType, false);
            }
        }

        JSValue keyType = asymmetricKeyType(globalObject);
        if (exportType == CryptoKeyType::Public) {
            ncrypto::EVPKeyPointer::PublicKeyEncodingConfig config;
            parsePublicKeyEncoding(globalObject, scope, options, keyType, WTF::nullStringView(), config);
            RETURN_IF_EXCEPTION(scope, {});
            return exportPublic(globalObject, scope, config);
        }

        ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig config;
        parsePrivateKeyEncoding(globalObject, scope, options, keyType, WTF::nullStringView(), config);
        RETURN_IF_EXCEPTION(scope, {});
        return exportPrivate(globalObject, scope, config);
    }

    // This would hit validateObject in `parseKeyEncoding`
    ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, optionsValue);
    return {};
}

JSValue KeyObject::exportSecret(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSValue optionsValue)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto exportBuffer = [this, lexicalGlobalObject, globalObject, &scope]() -> JSValue {
        auto key = symmetricKey();
        auto buf = ArrayBuffer::tryCreateUninitialized(key.size(), 1);
        if (!buf) {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
            return {};
        }
        memcpy(buf->data(), key.begin(), key.size());
        return JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buf), 0, key.size());
    };

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* options = jsDynamicCast<JSObject*>(optionsValue);

        JSValue formatValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!formatValue.isUndefined()) {
            if (formatValue.isString()) {
                auto* formatString = formatValue.toString(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(scope, {});
                auto formatView = formatString->view(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(scope, {});

                if (formatView == "jwk"_s) {
                    return exportJwk(lexicalGlobalObject, scope, CryptoKeyType::Secret, false);
                }

                if (formatView == "buffer"_s) {
                    return exportBuffer();
                }
            }

            ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "options.format"_s, formatValue, "must be one of: undefined, 'buffer', 'jwk'"_s);
            return {};
        }
    }

    return exportBuffer();
}

JSValue KeyObject::asymmetricKeyType(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    if (type() == CryptoKeyType::Secret) {
        return jsUndefined();
    }

    switch (m_data->asymmetricKey.id()) {
    case EVP_PKEY_RSA:
        return jsNontrivialString(vm, "rsa"_s);
    case EVP_PKEY_RSA_PSS:
        return jsNontrivialString(vm, "rsa-pss"_s);
    case EVP_PKEY_DSA:
        return jsNontrivialString(vm, "dsa"_s);
    case EVP_PKEY_DH:
        return jsNontrivialString(vm, "dh"_s);
    case EVP_PKEY_EC:
        return jsNontrivialString(vm, "ec"_s);
    case EVP_PKEY_ED25519:
        return jsNontrivialString(vm, "ed25519"_s);
    case EVP_PKEY_ED448:
        return jsNontrivialString(vm, "ed448"_s);
    case EVP_PKEY_X25519:
        return jsNontrivialString(vm, "x25519"_s);
    case EVP_PKEY_X448:
        return jsNontrivialString(vm, "x448"_s);
    default:
        return jsUndefined();
    }
}

void KeyObject::getRsaKeyDetails(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* result)
{
    VM& vm = globalObject->vm();

    const auto& pkey = m_data->asymmetricKey;
    const ncrypto::Rsa rsa = pkey;
    if (!rsa) {
        return;
    }

    auto pubKey = rsa.getPublicKey();

    result->putDirect(vm, Identifier::fromString(vm, "modulusLength"_s), jsNumber(ncrypto::BignumPointer::GetBitCount(pubKey.n)));

    auto publicExponentHex = BignumPointer::toHex(pubKey.e);
    if (!publicExponentHex) {
        ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to create publicExponent"_s);
        return;
    }

    JSValue publicExponent = JSBigInt::parseInt(globalObject, vm, publicExponentHex.span(), 16, JSBigInt::ErrorParseMode::IgnoreExceptions, JSBigInt::ParseIntSign::Unsigned);
    if (!publicExponent) {
        ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to create public exponent"_s);
        return;
    }

    result->putDirect(vm, Identifier::fromString(vm, "publicExponent"_s), publicExponent);

    if (pkey.id() == EVP_PKEY_RSA_PSS) {
        auto maybeParams = rsa.getPssParams();
        if (maybeParams.has_value()) {
            auto& params = maybeParams.value();
            result->putDirect(vm, Identifier::fromString(vm, "hashAlgorithm"_s), jsString(vm, params.digest));

            if (params.mgf1_digest.has_value()) {
                auto digest = params.mgf1_digest.value();
                result->putDirect(vm, Identifier::fromString(vm, "mgf1HashAlgorithm"_s), jsString(vm, digest));
            }

            result->putDirect(vm, Identifier::fromString(vm, "saltLength"_s), jsNumber(params.salt_length));
        }
    }
}

void KeyObject::getDsaKeyDetails(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* result)
{
    VM& vm = globalObject->vm();

    const ncrypto::Dsa dsa = m_data->asymmetricKey;
    if (!dsa) {
        return;
    }

    size_t modulusLength = dsa.getModulusLength();
    size_t divisorLength = dsa.getDivisorLength();

    result->putDirect(vm, Identifier::fromString(vm, "modulusLength"_s), jsNumber(modulusLength));
    result->putDirect(vm, Identifier::fromString(vm, "divisorLength"_s), jsNumber(divisorLength));
}

void KeyObject::getEcKeyDetails(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* result)
{
    VM& vm = globalObject->vm();

    const auto& pkey = m_data->asymmetricKey;
    ASSERT(pkey.id() == EVP_PKEY_EC);
    const EC_KEY* ec = pkey;

    const auto group = ncrypto::ECKeyPointer::GetGroup(ec);
    int nid = EC_GROUP_get_curve_name(group);

    String namedCurve = String::fromUTF8(OBJ_nid2sn(nid));

    result->putDirect(vm, Identifier::fromString(vm, "namedCurve"_s), jsString(vm, namedCurve));
}

JSObject* KeyObject::asymmetricKeyDetails(JSGlobalObject* globalObject, ThrowScope& scope)
{
    JSObject* result = JSC::constructEmptyObject(globalObject);

    if (type() == CryptoKeyType::Secret) {
        return result;
    }

    switch (m_data->asymmetricKey.id()) {
    case EVP_PKEY_RSA:
    case EVP_PKEY_RSA_PSS:
        getRsaKeyDetails(globalObject, scope, result);
        RETURN_IF_EXCEPTION(scope, {});
        break;
    case EVP_PKEY_DSA:
        getDsaKeyDetails(globalObject, scope, result);
        RETURN_IF_EXCEPTION(scope, {});
        break;
    case EVP_PKEY_EC: {
        getEcKeyDetails(globalObject, scope, result);
        RETURN_IF_EXCEPTION(scope, {});
        break;
    }
    default:
    }

    return result;
}

// returns std::nullopt for "unsupported crypto operation"
std::optional<bool> KeyObject::equals(const KeyObject& other) const
{
    auto thisType = type();
    auto otherType = other.type();
    if (thisType != otherType) {
        return false;
    }

    switch (thisType) {
    case CryptoKeyType::Secret: {
        auto thisKey = symmetricKey().span();
        auto otherKey = other.symmetricKey().span();

        if (thisKey.size() != otherKey.size()) {
            return false;
        }

        return CRYPTO_memcmp(thisKey.data(), otherKey.data(), thisKey.size()) == 0;
    }
    case CryptoKeyType::Public:
    case CryptoKeyType::Private: {
        EVP_PKEY* thisKey = m_data->asymmetricKey.get();
        EVP_PKEY* otherKey = other.m_data->asymmetricKey.get();

        int ok = EVP_PKEY_cmp(thisKey, otherKey);
        if (ok == -2) {
            return std::nullopt;
        }

        return ok == 1;
    }
    }
}

JSValue KeyObject::toCryptoKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue algorithmValue, JSValue extractableValue, JSValue keyUsagesValue)
{
    return jsUndefined();
}

static std::optional<const Vector<uint8_t>*> getSymmetricKey(const WebCore::CryptoKey& key)
{
    switch (key.keyClass()) {
    case WebCore::CryptoKeyClass::AES:
        return &downcast<CryptoKeyAES>(key).key();
    case WebCore::CryptoKeyClass::HMAC:
        return &downcast<CryptoKeyHMAC>(key).key();
    case WebCore::CryptoKeyClass::Raw:
        return &downcast<CryptoKeyRaw>(key).key();
    default: {
        return std::nullopt;
    }
    }
}

KeyObject KeyObject::create(CryptoKeyType type, RefPtr<KeyObjectData>&& data)
{
    return KeyObject(type, WTFMove(data));
}

WebCore::ExceptionOr<KeyObject> KeyObject::create(WebCore::CryptoKey& key)
{
    // Determine KeyCryptoKeyType and Extract Material
    switch (key.type()) {
    case WebCore::CryptoKeyType::Secret: {
        // Extract symmetric key data
        std::optional<const Vector<uint8_t>*> keyData = getSymmetricKey(key);
        if (!keyData) {
            return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Failed to extract secret key material"_s };
        }

        WTF::Vector<uint8_t> copy;
        copy.appendVector(*keyData.value());
        return create(WTFMove(copy));
    }

    case WebCore::CryptoKeyType::Public: {
        // Extract asymmetric public key data
        AsymmetricKeyValue keyValue(key);
        if (!keyValue.key) {
            return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Failed to extract public key material"_s };
        }

        // Increment ref count because KeyObject will own a reference
        EVP_PKEY_up_ref(keyValue.key);
        ncrypto::EVPKeyPointer keyPtr(keyValue.key);

        return create(CryptoKeyType::Public, WTFMove(keyPtr));
    }

    case WebCore::CryptoKeyType::Private: {
        // Extract asymmetric private key data
        AsymmetricKeyValue keyValue(key);
        if (!keyValue.key) {
            return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Failed to extract private key material"_s };
        }

        // Increment ref count because KeyObject will own a reference
        EVP_PKEY_up_ref(keyValue.key);
        ncrypto::EVPKeyPointer keyPtr(keyValue.key);

        return create(CryptoKeyType::Private, WTFMove(keyPtr));
    }
    }

    return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Unknown key type"_s };
}

KeyObject KeyObject::create(WTF::Vector<uint8_t>&& symmetricKey)
{
    RefPtr<KeyObjectData> data = KeyObjectData::create(WTFMove(symmetricKey));
    return KeyObject(CryptoKeyType::Secret, WTFMove(data));
}

KeyObject KeyObject::create(CryptoKeyType type, ncrypto::EVPKeyPointer&& asymmetricKey)
{
    RefPtr<KeyObjectData> data = KeyObjectData::create(WTFMove(asymmetricKey));
    return KeyObject(type, WTFMove(data));
}

void KeyObject::getKeyObjectFromHandle(JSGlobalObject* globalObject, ThrowScope& scope, JSValue keyValue, const KeyObject& handle, PrepareAsymmetricKeyMode mode)
{
    if (mode == PrepareAsymmetricKeyMode::CreatePrivate) {
        ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string, ArrayBuffer, Buffer, TypedArray, or DataView"_s, keyValue);
        return;
    }

    if (handle.type() != CryptoKeyType::Private) {
        if (mode == PrepareAsymmetricKeyMode::ConsumePrivate || mode == PrepareAsymmetricKeyMode::CreatePublic) {
            ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, handle.type(), "private"_s);
            return;
        }
        if (handle.type() != CryptoKeyType::Public) {
            ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, handle.type(), "private or public"_s);
            return;
        }
    }
}

JSArrayBufferView* decodeJwkString(JSGlobalObject* globalObject, ThrowScope& scope, GCOwnedDataScope<WTF::StringView> strView, ASCIILiteral keyName)
{
    JSValue decoded = JSValue::decode(constructFromEncoding(globalObject, strView, BufferEncodingType::base64));
    RETURN_IF_EXCEPTION(scope, {});
    auto* decodedBuf = jsDynamicCast<JSArrayBufferView*>(decoded);
    if (!decodedBuf) {
        ERR::INVALID_ARG_TYPE(scope, globalObject, keyName, "string"_s, decoded);
        return {};
    }
    return decodedBuf;
}

JSValue getJwkString(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* jwk, ASCIILiteral propName, ASCIILiteral keyName)
{
    JSValue value = jwk->get(globalObject, Identifier::fromString(globalObject->vm(), propName));
    RETURN_IF_EXCEPTION(scope, {});
    V::validateString(scope, globalObject, value, keyName);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

GCOwnedDataScope<WTF::StringView> getJwkStringView(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* jwk, ASCIILiteral propName, ASCIILiteral keyName)
{
    JSValue value = getJwkString(globalObject, scope, jwk, propName, keyName);
    RETURN_IF_EXCEPTION(scope, GCOwnedDataScope<WTF::StringView>(nullptr, WTF::nullStringView()));
    auto* str = value.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, GCOwnedDataScope<WTF::StringView>(nullptr, WTF::nullStringView()));
    auto strView = str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, GCOwnedDataScope<WTF::StringView>(nullptr, WTF::nullStringView()));
    return strView;
}

JSArrayBufferView* getDecodedJwkStringBuf(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* jwk, ASCIILiteral propName, ASCIILiteral keyName)
{
    auto strView = getJwkStringView(globalObject, scope, jwk, propName, keyName);
    RETURN_IF_EXCEPTION(scope, {});

    auto* dataBuf = decodeJwkString(globalObject, scope, strView, keyName);
    RETURN_IF_EXCEPTION(scope, {});

    return dataBuf;
}

inline BignumPointer jwkBufToBn(JSArrayBufferView* buf)
{
    return BignumPointer(reinterpret_cast<uint8_t*>(buf->vector()), buf->byteLength());
}

KeyObject KeyObject::getKeyObjectHandleFromJwk(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* jwk, PrepareAsymmetricKeyMode mode)
{
    auto ktyView = getJwkStringView(globalObject, scope, jwk, "kty"_s, "key.kty"_s);
    RETURN_IF_EXCEPTION(scope, {});

    enum class Kty {
        Rsa,
        Ec,
        Okp,
    };

    Kty kty;
    if (ktyView == "RSA"_s) {
        kty = Kty::Rsa;
    } else if (ktyView == "EC"_s) {
        kty = Kty::Ec;
    } else if (ktyView == "OKP"_s) {
        kty = Kty::Okp;
    } else {
        // validateOneOf
        ERR::INVALID_ARG_VALUE(scope, globalObject, "key.kty"_s, ktyView.owner, "must be one of: 'RSA', 'EC', 'OKP'"_s);
        return {};
    }

    CryptoKeyType keyType = mode == PrepareAsymmetricKeyMode::ConsumePublic || mode == PrepareAsymmetricKeyMode::CreatePublic
        ? CryptoKeyType::Public
        : CryptoKeyType::Private;

    switch (kty) {
    case Kty::Okp: {
        auto crvView = getJwkStringView(globalObject, scope, jwk, "crv"_s, "key.crv"_s);
        RETURN_IF_EXCEPTION(scope, {});

        int nid;
        if (crvView == "Ed25519"_s) {
            nid = EVP_PKEY_ED25519;
        } else if (crvView == "Ed448"_s) {
            nid = EVP_PKEY_ED448;
        } else if (crvView == "X25519"_s) {
            nid = EVP_PKEY_X25519;
        } else if (crvView == "X448"_s) {
            nid = EVP_PKEY_X448;
        } else {
            // validateOneOf
            ERR::INVALID_ARG_VALUE(scope, globalObject, "key.crv"_s, crvView.owner, "must be one of: 'Ed25519', 'Ed448', 'X25519', 'X448'"_s);
            return {};
        }

        auto xView = getJwkStringView(globalObject, scope, jwk, "x"_s, "key.x"_s);
        RETURN_IF_EXCEPTION(scope, {});

        GCOwnedDataScope<WTF::StringView> dView = GCOwnedDataScope<WTF::StringView>(nullptr, WTF::nullStringView());

        if (keyType != CryptoKeyType::Public) {
            dView = getJwkStringView(globalObject, scope, jwk, "d"_s, "key.d"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }

        auto dataView = keyType == CryptoKeyType::Public ? xView : dView;

        auto* dataBuf = decodeJwkString(globalObject, scope, dataView, "key.x"_s);
        RETURN_IF_EXCEPTION(scope, {});
        auto bufSpan = dataBuf->span();

        switch (nid) {
        case EVP_PKEY_ED25519:
        case EVP_PKEY_X25519:
            if (bufSpan.size() != 32) {
                ERR::CRYPTO_INVALID_JWK(scope, globalObject);
                return {};
            }
            break;
        case EVP_PKEY_ED448:
            if (bufSpan.size() != 57) {
                ERR::CRYPTO_INVALID_JWK(scope, globalObject);
                return {};
            }
            break;
        case EVP_PKEY_X448:
            if (bufSpan.size() != 56) {
                ERR::CRYPTO_INVALID_JWK(scope, globalObject);
                return {};
            }
            break;
        }

        MarkPopErrorOnReturn markPopError;

        auto buf = ncrypto::Buffer {
            .data = bufSpan.data(),
            .len = bufSpan.size(),
        };

        auto key = keyType == CryptoKeyType::Public
            ? EVPKeyPointer::NewRawPublic(nid, buf)
            : EVPKeyPointer::NewRawPrivate(nid, buf);

        if (!key) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject);
            return {};
        }

        return create(keyType, WTFMove(key));
    }
    case Kty::Ec: {
        auto crvView = getJwkStringView(globalObject, scope, jwk, "crv"_s, "key.crv"_s);
        RETURN_IF_EXCEPTION(scope, {});

        if (crvView != "P-256"_s && crvView != "secp256k1"_s && crvView != "P-384"_s && crvView != "P-521"_s) {
            // validateOneOf
            ERR::INVALID_ARG_VALUE(scope, globalObject, "key.crv"_s, crvView.owner, "must be one of: 'P-256', 'secp256k1', 'P-384', 'P-521'"_s);
            return {};
        }

        auto xView = getJwkStringView(globalObject, scope, jwk, "x"_s, "key.x"_s);
        RETURN_IF_EXCEPTION(scope, {});
        auto yView = getJwkStringView(globalObject, scope, jwk, "y"_s, "key.y"_s);
        RETURN_IF_EXCEPTION(scope, {});

        GCOwnedDataScope<WTF::StringView> dView = GCOwnedDataScope<WTF::StringView>(nullptr, WTF::nullStringView());

        if (keyType != CryptoKeyType::Public) {
            dView = getJwkStringView(globalObject, scope, jwk, "d"_s, "key.d"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }

        MarkPopErrorOnReturn markPopError;

        auto crvUtf8 = crvView->utf8();
        int nid = Ec::GetCurveIdFromName(crvUtf8.data());
        if (nid == NID_undef) {
            ERR::CRYPTO_INVALID_CURVE(scope, globalObject);
            return {};
        }

        auto ec = ECKeyPointer::NewByCurveName(nid);
        if (!ec) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject);
            return {};
        }

        auto* xBuf = decodeJwkString(globalObject, scope, xView, "key.x"_s);
        RETURN_IF_EXCEPTION(scope, {});
        auto* yBuf = decodeJwkString(globalObject, scope, yView, "key.y"_s);
        RETURN_IF_EXCEPTION(scope, {});

        if (!ec.setPublicKeyRaw(jwkBufToBn(xBuf), jwkBufToBn(yBuf))) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK EC key"_s);
            return {};
        }

        if (keyType != CryptoKeyType::Public) {
            auto* dBuf = decodeJwkString(globalObject, scope, dView, "key.d"_s);
            auto dBufSpan = dBuf->span();
            BignumPointer dBn = BignumPointer(dBufSpan.data(), dBufSpan.size());
            if (!ec.setPrivateKey(dBn)) {
                ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK EC key"_s);
                return {};
            }
        }

        auto key = EVPKeyPointer::New();
        key.set(ec);

        return create(keyType, WTFMove(key));
    }
    case Kty::Rsa: {
        auto nView = getJwkStringView(globalObject, scope, jwk, "n"_s, "key.n"_s);
        RETURN_IF_EXCEPTION(scope, {});
        auto eView = getJwkStringView(globalObject, scope, jwk, "e"_s, "key.e"_s);
        RETURN_IF_EXCEPTION(scope, {});

        auto* nBuf = decodeJwkString(globalObject, scope, nView, "key.n"_s);
        RETURN_IF_EXCEPTION(scope, {});
        auto* eBuf = decodeJwkString(globalObject, scope, eView, "key.e"_s);
        RETURN_IF_EXCEPTION(scope, {});

        RSAPointer rsa(RSA_new());
        Rsa rsaView(rsa.get());

        if (!rsaView.setPublicKey(jwkBufToBn(nBuf), jwkBufToBn(eBuf))) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK RSA key"_s);
            return {};
        }

        if (keyType == CryptoKeyType::Private) {
            auto* dBuf = getDecodedJwkStringBuf(globalObject, scope, jwk, "d"_s, "key.d"_s);
            RETURN_IF_EXCEPTION(scope, {});
            auto* pBuf = getDecodedJwkStringBuf(globalObject, scope, jwk, "p"_s, "key.p"_s);
            RETURN_IF_EXCEPTION(scope, {});
            auto* qBuf = getDecodedJwkStringBuf(globalObject, scope, jwk, "q"_s, "key.q"_s);
            RETURN_IF_EXCEPTION(scope, {});
            auto* dpBuf = getDecodedJwkStringBuf(globalObject, scope, jwk, "dp"_s, "key.dp"_s);
            RETURN_IF_EXCEPTION(scope, {});
            auto* dqBuf = getDecodedJwkStringBuf(globalObject, scope, jwk, "dq"_s, "key.dq"_s);
            RETURN_IF_EXCEPTION(scope, {});
            auto* qiBuf = getDecodedJwkStringBuf(globalObject, scope, jwk, "qi"_s, "key.qi"_s);
            RETURN_IF_EXCEPTION(scope, {});

            if (!rsaView.setPrivateKey(
                    jwkBufToBn(dBuf),
                    jwkBufToBn(qBuf),
                    jwkBufToBn(pBuf),
                    jwkBufToBn(dpBuf),
                    jwkBufToBn(dqBuf),
                    jwkBufToBn(qiBuf))) {
                ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK RSA key"_s);
                return {};
            }
        }

        auto key = EVPKeyPointer::NewRSA(WTFMove(rsa));
        return create(keyType, WTFMove(key));
    }
    }

    UNREACHABLE();
}

void KeyObject::getKeyFormatAndType(
    EVPKeyPointer::PKFormatType formatType,
    std::optional<EVPKeyPointer::PKEncodingType> encodingType,
    KeyEncodingContext ctx,
    EVPKeyPointer::AsymmetricKeyEncodingConfig& config)
{
    // if (!formatType) {
    //     ASSERT(ctx == KeyEncodingContext::Generate);
    //     config.output_key_object = true;
    // } else {
    config.output_key_object = false;

    config.format = formatType;

    if (encodingType) {
        config.type = *encodingType;
    } else {
        ASSERT((ctx == KeyEncodingContext::Input && config.format == EVPKeyPointer::PKFormatType::PEM)
            || (ctx == KeyEncodingContext::Generate && config.format == EVPKeyPointer::PKFormatType::JWK));
        config.type = EVPKeyPointer::PKEncodingType::PKCS1;
    }
    // }
}

EVPKeyPointer::PrivateKeyEncodingConfig KeyObject::getPrivateKeyEncoding(
    JSGlobalObject* globalObject,
    ThrowScope& scope,
    EVPKeyPointer::PKFormatType formatType,
    std::optional<EVPKeyPointer::PKEncodingType> encodingType,
    const EVP_CIPHER* cipher,
    std::optional<DataPointer> passphrase,
    KeyEncodingContext ctx)
{
    EVPKeyPointer::PrivateKeyEncodingConfig config;
    getKeyFormatAndType(formatType, encodingType, ctx, config);

    if (config.output_key_object) {
        // TODO: make sure this case for key generation is handled
    } else {
        if (ctx != KeyEncodingContext::Input) {
            config.cipher = cipher;
        }

        if (passphrase) {
            config.passphrase = WTFMove(*passphrase);
        }
    }

    return config;
}

// KeyObjectHandle::init for public and private keys
KeyObject KeyObject::getPublicOrPrivateKey(
    JSGlobalObject* globalObject,
    ThrowScope& scope,
    std::span<const uint8_t> keyData,
    CryptoKeyType keyType,
    EVPKeyPointer::PKFormatType formatType,
    std::optional<EVPKeyPointer::PKEncodingType> encodingType,
    const EVP_CIPHER* cipher,
    std::optional<DataPointer> passphrase)
{
    auto buf = ncrypto::Buffer<const uint8_t> {
        .data = reinterpret_cast<const uint8_t*>(keyData.data()),
        .len = keyData.size(),
    };

    if (keyType == CryptoKeyType::Private) {
        auto config = getPrivateKeyEncoding(
            globalObject,
            scope,
            formatType,
            encodingType,
            cipher,
            WTFMove(passphrase),
            KeyEncodingContext::Input);
        RETURN_IF_EXCEPTION(scope, {});

        auto res = EVPKeyPointer::TryParsePrivateKey(config, buf);
        if (res) {
            return create(CryptoKeyType::Private, WTFMove(res.value));
        }

        if (res.error.value() == EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
            ERR::MISSING_PASSPHRASE(scope, globalObject, "Passphrase required for encrypted key"_s);
        } else {
            throwCryptoError(globalObject, scope, res.openssl_error.value_or(0), "Failed to read private key"_s);
        }
        return {};
    }

    if (buf.len > INT_MAX) {
        ERR::OUT_OF_RANGE(scope, globalObject, "keyData is too big"_s);
        return {};
    }

    auto config = getPrivateKeyEncoding(
        globalObject,
        scope,
        formatType,
        encodingType,
        cipher,
        WTFMove(passphrase),
        KeyEncodingContext::Input);
    RETURN_IF_EXCEPTION(scope, {});

    if (config.format == EVPKeyPointer::PKFormatType::PEM) {
        auto publicRes = EVPKeyPointer::TryParsePublicKeyPEM(buf);
        if (publicRes) {
            return create(CryptoKeyType::Public, WTFMove(publicRes.value));
        }

        if (publicRes.error.value() == EVPKeyPointer::PKParseError::NOT_RECOGNIZED) {
            auto privateRes = EVPKeyPointer::TryParsePrivateKey(config, buf);
            if (privateRes) {
                return create(CryptoKeyType::Public, WTFMove(privateRes.value));
            }

            if (privateRes.error.value() == EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
                ERR::MISSING_PASSPHRASE(scope, globalObject, "Passphrase required for encrypted key"_s);
            } else {
                throwCryptoError(globalObject, scope, privateRes.openssl_error.value_or(0), "Failed to read private key"_s);
            }
            return {};
        }

        throwCryptoError(globalObject, scope, publicRes.openssl_error.value_or(0), "Failed to read asymmetric key"_s);
        return {};
    }

    static const auto isPublic = [](const auto& config, const auto& buffer) -> bool {
        switch (config.type) {
        case EVPKeyPointer::PKEncodingType::PKCS1:
            return !EVPKeyPointer::IsRSAPrivateKey(buffer);
        case EVPKeyPointer::PKEncodingType::SPKI:
            return true;
        case EVPKeyPointer::PKEncodingType::PKCS8:
            return false;
        case EVPKeyPointer::PKEncodingType::SEC1:
            return false;
        default:
            return false;
        }
    };

    if (isPublic(config, buf)) {
        auto res = EVPKeyPointer::TryParsePublicKey(config, buf);
        if (res) {
            return create(CryptoKeyType::Public, WTFMove(res.value));
        }

        throwCryptoError(globalObject, scope, res.openssl_error.value_or(0), "Failed to read asymmetric key"_s);
        return {};
    }

    auto res = EVPKeyPointer::TryParsePrivateKey(config, buf);
    if (res) {
        return create(CryptoKeyType::Private, WTFMove(res.value));
    }

    if (res.error.value() == EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
        ERR::MISSING_PASSPHRASE(scope, globalObject, "Passphrase required for encrypted key"_s);
    } else {
        throwCryptoError(globalObject, scope, res.openssl_error.value_or(0), "Failed to read asymmetric key"_s);
    }
    return {};
}

KeyObject::PrepareAsymmetricKeyResult KeyObject::prepareAsymmetricKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue, PrepareAsymmetricKeyMode mode)
{
    VM& vm = globalObject->vm();

    auto checkKeyObject = [globalObject, &scope, mode](const KeyObject& keyObject, JSValue keyValue) -> void {
        if (mode == PrepareAsymmetricKeyMode::CreatePrivate) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string, ArrayBuffer, Buffer, TypedArray, or DataView"_s, keyValue);
            return;
        }

        if (keyObject.type() != CryptoKeyType::Private) {
            if (mode == PrepareAsymmetricKeyMode::ConsumePrivate || mode == PrepareAsymmetricKeyMode::CreatePublic) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, keyObject.type(), "private"_s);
                return;
            }
            if (keyObject.type() != CryptoKeyType::Public) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, keyObject.type(), "private or public"_s);
                return;
            }
        }
    };

    auto checkCryptoKey = [globalObject, &scope, mode](const CryptoKey& cryptoKey, JSValue keyValue) -> void {
        if (mode == PrepareAsymmetricKeyMode::CreatePrivate) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string, ArrayBuffer, Buffer, TypedArray, or DataView"_s, keyValue);
            return;
        }

        if (cryptoKey.type() != CryptoKeyType::Private) {
            if (mode == PrepareAsymmetricKeyMode::ConsumePrivate || mode == PrepareAsymmetricKeyMode::CreatePublic) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, cryptoKey.type(), "private"_s);
                return;
            }
            if (cryptoKey.type() != CryptoKeyType::Public) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, cryptoKey.type(), "private or public"_s);
                return;
            }
        }
    };

    if (JSKeyObject* keyObject = jsDynamicCast<JSKeyObject*>(keyValue)) {
        auto& handle = keyObject->handle();
        checkKeyObject(handle, keyValue);
        RETURN_IF_EXCEPTION(scope, {});
        return { .keyData = handle.data() };
    }

    if (JSCryptoKey* cryptoKey = jsDynamicCast<JSCryptoKey*>(keyValue)) {
        auto& key = cryptoKey->wrapped();
        checkCryptoKey(key, keyValue);
        RETURN_IF_EXCEPTION(scope, {});

        auto keyObject = create(key);
        if (keyObject.hasException()) [[unlikely]] {
            WebCore::propagateException(*globalObject, scope, keyObject.releaseException());
            return {};
        }
        KeyObject handle = keyObject.releaseReturnValue();
        RETURN_IF_EXCEPTION(scope, {});
        return { .keyData = handle.data() };
    }

    { // pem format
        if (keyValue.isString()) {
            auto* keyString = keyValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto keyView = keyString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            JSValue decoded = JSValue::decode(constructFromEncoding(globalObject, keyView, BufferEncodingType::utf8));
            RETURN_IF_EXCEPTION(scope, {});

            auto* decodedBuf = jsDynamicCast<JSArrayBufferView*>(decoded);
            if (!decodedBuf) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string"_s, decoded);
                return {};
            }

            return {
                .keyDataView = { decodedBuf, decodedBuf->span() },
                .formatType = EVPKeyPointer::PKFormatType::PEM,
            };
        }

        if (auto* view = jsDynamicCast<JSArrayBufferView*>(keyValue)) {
            return {
                .keyDataView = { view, view->span() },
                .formatType = EVPKeyPointer::PKFormatType::PEM,
            };
        }

        if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(keyValue)) {
            auto* buffer = arrayBuffer->impl();
            return {
                .keyDataView = { arrayBuffer, buffer->span() },
                .formatType = EVPKeyPointer::PKFormatType::PEM,
            };
        }
    }

    if (JSObject* keyObj = jsDynamicCast<JSObject*>(keyValue)) {
        JSValue dataValue = keyObj->get(globalObject, Identifier::fromString(vm, "key"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue encodingValue = keyObj->get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue formatValue = keyObj->get(globalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (JSKeyObject* keyObject = jsDynamicCast<JSKeyObject*>(dataValue)) {
            auto& handle = keyObject->handle();
            checkKeyObject(handle, dataValue);
            RETURN_IF_EXCEPTION(scope, {});
            return { .keyData = handle.data() };
        }

        if (JSCryptoKey* cryptoKey = jsDynamicCast<JSCryptoKey*>(dataValue)) {
            auto& key = cryptoKey->wrapped();
            checkCryptoKey(key, dataValue);
            RETURN_IF_EXCEPTION(scope, {});

            auto keyObject = create(key);
            if (keyObject.hasException()) [[unlikely]] {
                WebCore::propagateException(*globalObject, scope, keyObject.releaseException());
            }
            KeyObject handle = keyObject.releaseReturnValue();
            return { .keyData = handle.data() };
        }

        auto* formatString = formatValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto formatView = formatString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (formatView == "jwk"_s) {
            V::validateObject(scope, globalObject, dataValue, "key.key"_s);
            RETURN_IF_EXCEPTION(scope, {});
            JSObject* jwk = dataValue.getObject();
            KeyObject handle = getKeyObjectHandleFromJwk(globalObject, scope, jwk, mode);
            RETURN_IF_EXCEPTION(scope, {});
            return { .keyData = handle.data() };
        }

        std::optional<bool> isPublic = mode == PrepareAsymmetricKeyMode::ConsumePrivate || mode == PrepareAsymmetricKeyMode::CreatePrivate
            ? std::optional<bool>(false)
            : std::nullopt;

        if (dataValue.isString()) {
            auto* dataString = dataValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto dataView = dataString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            BufferEncodingType encoding = BufferEncodingType::utf8;
            if (encodingValue.isString()) {
                auto* encodingString = encodingValue.toString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                auto encodingView = encodingString->view(globalObject);
                RETURN_IF_EXCEPTION(scope, {});

                if (encodingView != "buffer"_s) {
                    encoding = parseEnumerationFromView<BufferEncodingType>(encodingView).value_or(BufferEncodingType::utf8);
                    RETURN_IF_EXCEPTION(scope, {});
                }
            }

            JSValue decoded = JSValue::decode(constructFromEncoding(globalObject, dataView, encoding));
            RETURN_IF_EXCEPTION(scope, {});
            if (auto* decodedView = jsDynamicCast<JSArrayBufferView*>(decoded)) {
                EVPKeyPointer::PrivateKeyEncodingConfig config;
                parseKeyEncoding(globalObject, scope, keyObj, jsUndefined(), isPublic, WTF::nullStringView(), config);
                RETURN_IF_EXCEPTION(scope, {});

                return {
                    .keyDataView = { decodedView, decodedView->span() },
                    .formatType = config.format,
                    .encodingType = config.type,
                    .cipher = config.cipher,
                    .passphrase = WTFMove(config.passphrase),
                };
            }
        }

        if (auto* view = jsDynamicCast<JSArrayBufferView*>(dataValue)) {
            auto buffer = view->span();

            EVPKeyPointer::PrivateKeyEncodingConfig config;
            parseKeyEncoding(globalObject, scope, keyObj, jsUndefined(), isPublic, WTF::nullStringView(), config);
            RETURN_IF_EXCEPTION(scope, {});

            return {
                .keyDataView = { view, buffer },
                .formatType = config.format,
                .encodingType = config.type,
                .cipher = config.cipher,
                .passphrase = WTFMove(config.passphrase),
            };
        }

        if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(dataValue)) {
            auto* buffer = arrayBuffer->impl();
            auto data = buffer->span();

            EVPKeyPointer::PrivateKeyEncodingConfig config;
            parseKeyEncoding(globalObject, scope, keyObj, jsUndefined(), isPublic, WTF::nullStringView(), config);
            RETURN_IF_EXCEPTION(scope, {});

            return {
                .keyDataView = { arrayBuffer, data },
                .formatType = config.format,
                .encodingType = config.type,
                .cipher = config.cipher,
                .passphrase = WTFMove(config.passphrase),
            };
        }

        if (mode != PrepareAsymmetricKeyMode::CreatePrivate) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "key.key"_s, "string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey"_s, dataValue);
        } else {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "key.key"_s, "string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView"_s, dataValue);
        }
        return {};
    }

    if (mode != PrepareAsymmetricKeyMode::CreatePrivate) {
        ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey"_s, keyValue);
    } else {
        ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView"_s, keyValue);
    }

    return {};
}

KeyObject::PrepareAsymmetricKeyResult KeyObject::preparePrivateKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue keyValue)
{
    return prepareAsymmetricKey(globalObject, scope, keyValue, PrepareAsymmetricKeyMode::ConsumePrivate);
}

KeyObject::PrepareAsymmetricKeyResult KeyObject::preparePublicOrPrivateKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue keyValue)
{
    return prepareAsymmetricKey(globalObject, scope, keyValue, PrepareAsymmetricKeyMode::ConsumePublic);
}

KeyObject KeyObject::prepareSecretKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue keyValue, JSValue encodingValue, bool bufferOnly)
{
    if (!bufferOnly) {
        if (JSKeyObject* keyObject = jsDynamicCast<JSKeyObject*>(keyValue)) {
            auto& handle = keyObject->handle();
            if (handle.type() != CryptoKeyType::Secret) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, handle.type(), "secret"_s);
                return {};
            }
            return handle;
        } else if (JSCryptoKey* cryptoKey = jsDynamicCast<JSCryptoKey*>(keyValue)) {
            auto& key = cryptoKey->wrapped();
            if (key.type() != CryptoKeyType::Secret) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, key.type(), "secret"_s);
                return {};
            }
            auto keyObject = create(key);
            if (keyObject.hasException()) [[unlikely]] {
                WebCore::propagateException(globalObject, scope, keyObject.releaseException());
                return {};
            }
            return keyObject.releaseReturnValue();
        }
    }

    if (keyValue.isString()) {
        auto* keyString = keyValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto keyView = keyString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        BufferEncodingType encoding = parseEnumerationAllowBuffer(*globalObject, encodingValue).value_or(BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue buffer = JSValue::decode(constructFromEncoding(globalObject, keyView, encoding));
        RETURN_IF_EXCEPTION(scope, {});

        if (buffer.isEmpty()) {
            // Both this exception and the one below should be unreachable, but constructFromEncoding doesn't
            // guarentee that it will always return a valid buffer.
            ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, keyValue, "must be a valid encoding"_s);
            return {};
        }

        auto* view = jsDynamicCast<JSArrayBufferView*>(buffer);
        if (!view) {
            ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, keyValue, "must be a valid encoding"_s);
            return {};
        }

        Vector<uint8_t> copy;
        copy.append(view->span());
        return create(WTFMove(copy));
    }

    // TODO(dylan-conway): avoid copying by keeping the buffer alive
    if (auto* view = jsDynamicCast<JSArrayBufferView*>(keyValue)) {
        Vector<uint8_t> copy;
        copy.append(view->span());
        return create(WTFMove(copy));
    }

    // TODO(dylan-conway): avoid copying by keeping the buffer alive
    if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(keyValue)) {
        auto* impl = arrayBuffer->impl();
        Vector<uint8_t> copy;
        copy.append(impl->span());
        return create(WTFMove(copy));
    }

    if (bufferOnly) {
        ERR::INVALID_ARG_INSTANCE(scope, globalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, or DataView"_s, keyValue);
    } else {
        ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey"_s, keyValue);
    }

    return {};
}
}
