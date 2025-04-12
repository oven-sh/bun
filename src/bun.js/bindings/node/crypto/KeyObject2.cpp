#include "KeyObject2.h"
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

// #include <JavaScriptCore/JSBigInt.h>

namespace Bun {

using namespace Bun;
using namespace JSC;

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

JSC::JSValue KeyObject::exportJWKEdKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, Type exportType)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    const auto& pkey = m_asymmetricKey;

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

    if (exportType == KeyObject::Type::Private) {
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

JSC::JSValue KeyObject::exportJWKEcKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, Type exportType)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    const auto& pkey = m_asymmetricKey;
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

    if (exportType == KeyObject::Type::Private) {
        auto pvt = ncrypto::ECKeyPointer::GetPrivateKey(ec);
        setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkDString(lexicalGlobalObject), pvt, degree_bytes);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return jwk;
}

JSC::JSValue KeyObject::exportJWKRsaKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, Type exportType)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    const auto& pkey = m_asymmetricKey;
    const ncrypto::Rsa rsa = pkey;

    auto publicKey = rsa.getPublicKey();

    jwk->putDirect(vm,
        Identifier::fromString(vm, commonStrings.jwkKtyString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        commonStrings.jwkRsaString(lexicalGlobalObject));

    setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkNString(lexicalGlobalObject), publicKey.n);
    RETURN_IF_EXCEPTION(scope, {});
    setEncodedValue(lexicalGlobalObject, scope, jwk, commonStrings.jwkEString(lexicalGlobalObject), publicKey.e);
    RETURN_IF_EXCEPTION(scope, {});

    if (exportType == KeyObject::Type::Private) {
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

JSC::JSValue KeyObject::exportJWKSecretKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope)
{

    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    JSValue encoded = JSValue::decode(StringBytes::encode(lexicalGlobalObject, scope, m_symmetricKey, BufferEncodingType::base64url));
    RETURN_IF_EXCEPTION(scope, {});

    jwk->putDirect(vm,
        Identifier::fromString(vm, commonStrings.jwkKtyString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        commonStrings.jwkOctString(lexicalGlobalObject));

    jwk->putDirect(vm,
        Identifier::fromString(vm, commonStrings.jwkKString(lexicalGlobalObject)->value(lexicalGlobalObject)),
        encoded);

    return jwk;
}

JSC::JSValue KeyObject::exportJWKAsymmetricKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, KeyObject::Type exportType, bool handleRsaPss)
{
    switch (m_asymmetricKey.id()) {
    case EVP_PKEY_RSA_PSS: {
        if (handleRsaPss) {
            return exportJWKRsaKey(globalObject, scope, exportType);
        }
        break;
    }

    case EVP_PKEY_RSA:
        return exportJWKRsaKey(globalObject, scope, exportType);

    case EVP_PKEY_EC:
        return exportJWKEcKey(globalObject, scope, exportType);

    case EVP_PKEY_ED25519:
    case EVP_PKEY_ED448:
    case EVP_PKEY_X25519:
    case EVP_PKEY_X448:
        return exportJWKEdKey(globalObject, scope, exportType);
    }

    ERR::CRYPTO_JWK_UNSUPPORTED_KEY_TYPE(scope, globalObject);
    return {};
}

JSC::JSValue KeyObject::exportJWK(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, KeyObject::Type type, bool handleRsaPss)
{
    if (type == KeyObject::Type::Secret) {
        return exportJWKSecretKey(globalObject, scope);
    }

    return exportJWKAsymmetricKey(globalObject, scope, type, handleRsaPss);
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

    Structure* structure = globalObject->m_JSBufferClassStructure.get(lexicalGlobalObject);
    return JSUint8Array::create(lexicalGlobalObject, structure, WTFMove(buf), 0, buf->byteLength());
}

JSC::JSValue KeyObject::exportPublic(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const ncrypto::EVPKeyPointer::PublicKeyEncodingConfig& config)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    ASSERT(m_type != KeyObject::Type::Secret);

    if (config.output_key_object) {
        Structure* structure = globalObject->m_JSPublicKeyObjectClassStructure.get(lexicalGlobalObject);
        JSPublicKeyObject* publicKey = JSPublicKeyObject::create(vm, structure, lexicalGlobalObject, KeyObject::Type::Public, WTFMove(m_asymmetricKey));
        return publicKey;
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
        return exportJWK(lexicalGlobalObject, scope, KeyObject::Type::Public, false);
    }

    const ncrypto::EVPKeyPointer& pkey = m_asymmetricKey;
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

    ASSERT(m_type != KeyObject::Type::Secret);

    if (config.output_key_object) {
        Structure* structure = globalObject->m_JSPrivateKeyObjectClassStructure.get(lexicalGlobalObject);
        JSPrivateKeyObject* privateKey = JSPrivateKeyObject::create(vm, structure, lexicalGlobalObject, KeyObject::Type::Private, WTFMove(m_asymmetricKey));
        return privateKey;
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
        return exportJWK(lexicalGlobalObject, scope, KeyObject::Type::Private, false);
    }

    const ncrypto::EVPKeyPointer& pkey = m_asymmetricKey;
    auto res = pkey.writePrivateKey(config);
    if (!res) {
        throwCryptoError(lexicalGlobalObject, scope, res.openssl_error.value_or(0), "Failed to encode private key");
        return {};
    }

    return toJS(lexicalGlobalObject, scope, res.value, config);
}

JSValue KeyObject::exportAsymmetric(JSGlobalObject* globalObject, ThrowScope& scope, JSValue optionsValue, Type exportType)
{
    VM& vm = globalObject->vm();

    ASSERT(m_type != Type::Secret);

    if (JSObject* options = jsDynamicCast<JSObject*>(optionsValue)) {
        JSValue formatValue = options->get(globalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (formatValue.isString()) {
            auto* formatString = formatValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto formatView = formatString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (exportType == Type::Private) {
                JSValue passphraseValue = options->get(globalObject, Identifier::fromString(vm, "passphrase"_s));
                RETURN_IF_EXCEPTION(scope, {});
                if (!passphraseValue.isUndefined()) {
                    ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, "jwk"_s, "does not support encryption"_s);
                    return {};
                }
            }

            return exportJWK(globalObject, scope, exportType, false);
        }

        JSValue keyType = asymmetricKeyType(globalObject);
        if (exportType == Type::Public) {
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

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* options = jsDynamicCast<JSObject*>(optionsValue);
        bool jwk = false;

        JSValue formatValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (formatValue.isString()) {
            auto* formatString = formatValue.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto formatView = formatString->view(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (formatView != "buffer"_s && formatView != "jwk"_s) {
                jwk = true;
                ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "options.format"_s, formatValue, "must be one of: undefined, 'buffer', 'jwk'"_s);
                return {};
            }

        } else if (!formatValue.isUndefined()) {
            ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "options.format"_s, formatValue, "must be one of: undefined, 'buffer', 'jwk'"_s);
            return {};
        }

        if (jwk) {
            return exportJWK(lexicalGlobalObject, scope, KeyObject::Type::Secret, false);
        }
    }

    auto symmetricKey = m_symmetricKey.span();

    RefPtr<ArrayBuffer> buf = JSC::ArrayBuffer::tryCreateUninitialized(symmetricKey.size(), 1);
    if (!buf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }
    memcpy(buf->data(), symmetricKey.data(), symmetricKey.size());

    Structure* structure = globalObject->m_JSBufferClassStructure.get(lexicalGlobalObject);
    return JSUint8Array::create(lexicalGlobalObject, structure, WTFMove(buf), 0, buf->byteLength());
}

JSValue KeyObject::asymmetricKeyType(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    if (m_type == Type::Secret) {
        return jsUndefined();
    }

    switch (m_asymmetricKey.id()) {
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

    const auto& pkey = m_asymmetricKey;
    const ncrypto::Rsa rsa = pkey;
    if (!rsa) {
        return;
    }

    auto pubKey = rsa.getPublicKey();

    result->putDirect(vm, Identifier::fromString(vm, "modulusLength"_s), jsNumber(ncrypto::BignumPointer::GetBitCount(pubKey.n)));

    Vector<uint8_t> publicExponentBuf;
    if (!publicExponentBuf.tryGrow(ncrypto::BignumPointer::GetByteCount(pubKey.e))) {
        throwOutOfMemoryError(globalObject, scope);
        return;
    }
    ncrypto::BignumPointer::EncodePaddedInto(pubKey.e, publicExponentBuf.data(), publicExponentBuf.size());

    // TODO: this probably is broken!
    JSValue publicExponent = JSBigInt::parseInt(globalObject, vm, publicExponentBuf.span(), 1, JSBigInt::ErrorParseMode::IgnoreExceptions, JSBigInt::ParseIntSign::Unsigned);
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

    const ncrypto::Dsa dsa = m_asymmetricKey;
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

    const auto& pkey = m_asymmetricKey;
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

    if (m_type == Type::Secret) {
        return result;
    }

    switch (m_asymmetricKey.id()) {
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
    if (m_type != other.m_type) {
        return false;
    }

    switch (m_type) {
    case Type::Secret: {
        auto thisKey = m_symmetricKey.span();
        auto otherKey = other.m_symmetricKey.span();

        if (thisKey.size() != otherKey.size()) {
            return false;
        }

        return CRYPTO_memcmp(thisKey.data(), otherKey.data(), thisKey.size()) == 0;
    }
    case Type::Public:
    case Type::Private: {
        EVP_PKEY* thisKey = m_asymmetricKey.get();
        EVP_PKEY* otherKey = other.m_asymmetricKey.get();

        int ok = EVP_PKEY_cmp(thisKey, otherKey);
        if (ok == -2) {
            return std::nullopt;
        }

        return ok == 1;
    }
    }
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

WebCore::ExceptionOr<KeyObject> KeyObject::create(WebCore::CryptoKey& key)
{
    // Determine Key Type and Extract Material
    switch (key.type()) {
    case WebCore::CryptoKeyType::Secret: {
        // Extract symmetric key data
        std::optional<const Vector<uint8_t>*> keyData = getSymmetricKey(key);
        if (!keyData) {
            return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Failed to extract secret key material"_s };
        }

        WTF::FixedVector<uint8_t> keyDataVec = WTF::FixedVector<uint8_t>(keyData.value()->begin(), keyData.value()->end());
        return KeyObject(WTFMove(keyDataVec));
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

        return KeyObject(Type::Public, WTFMove(keyPtr));
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

        return KeyObject(Type::Private, WTFMove(keyPtr));
    }
    }

    return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Unknown key type"_s };
}

}
