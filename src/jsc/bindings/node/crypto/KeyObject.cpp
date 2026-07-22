#include "KeyObject.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"
#include "helpers.h"
#include "ZigGlobalObject.h"
#include "CryptoUtil.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "AsymmetricKeyValue.h"
#include "CryptoAlgorithm.h"
#include "CryptoAlgorithmParameters.h"
#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyAES.h"
#include "CryptoKeyAKP.h"
#include "CryptoKeyHMAC.h"
#include "CryptoKeyRaw.h"
#include "CryptoKey.h"
#include "CryptoKeyType.h"
#include "JSCryptoKey.h"
#include "JSCryptoKeyUsage.h"
#include "SubtleCrypto.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertObject.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMConvertEnumeration.h"
#include "JSDOMExceptionHandling.h"
#include "OpenSSLUtilities.h"
#include "CryptoGenKeyPair.h"
#include "JSBuffer.h"
#include "BunString.h"
#include "BunProcess.h"

extern "C" bool Bun__Node__ProcessNoDeprecation;

namespace Bun {

using namespace Bun;
using namespace JSC;
using namespace ncrypto;
using namespace WebCore;

// DEP0203: passing a WebCrypto CryptoKey (instead of a KeyObject) to node:crypto
// functions is deprecated but still accepted. Emitted at most once per realm, like Node.
static void emitCryptoKeyDeprecationWarning(JSGlobalObject* globalObject)
{
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    if (zigGlobalObject->hasWarnedCryptoKeyDeprecation || Bun__Node__ProcessNoDeprecation)
        return;
    zigGlobalObject->hasWarnedCryptoKeyDeprecation = true;
    auto& vm = globalObject->vm();
    Process::emitWarning(globalObject,
        jsString(vm, makeString("Passing a CryptoKey to node:crypto functions is deprecated."_s)),
        jsString(vm, makeString("DeprecationWarning"_s)),
        jsString(vm, makeString("DEP0203"_s)),
        jsUndefined());
}

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

// BoringSSL represents ML-DSA / ML-KEM private keys as a seed (32 bytes for
// ML-DSA, 64 bytes of d||z for ML-KEM), reached through a dedicated API rather
// than the raw-private-key one.
static ncrypto::DataPointer getPrivateSeed(const ncrypto::EVPKeyPointer& pkey)
{
    ncrypto::MarkPopErrorOnReturn markPopError;
    size_t len = 0;
    if (!EVP_PKEY_get_private_seed(pkey.get(), nullptr, &len))
        return {};
    auto buf = ncrypto::DataPointer::Alloc(len);
    if (!buf)
        return {};
    if (!EVP_PKEY_get_private_seed(pkey.get(), static_cast<unsigned char*>(buf.get()), &len))
        return {};
    return buf;
}

static ncrypto::EVPKeyPointer newFromPrivateSeed(int nid, std::span<const uint8_t> seed)
{
    const EVP_PKEY_ALG* alg = pqcNidToAlg(nid);
    if (!alg)
        return {};
    return ncrypto::EVPKeyPointer(EVP_PKEY_from_private_seed(alg, seed.data(), seed.size()));
}

static ncrypto::EVPKeyPointer newFromRawPublic(int nid, std::span<const uint8_t> pub)
{
    const EVP_PKEY_ALG* alg = pqcNidToAlg(nid);
    if (!alg)
        return {};
    return ncrypto::EVPKeyPointer(EVP_PKEY_from_raw_public_key(alg, pub.data(), pub.size()));
}

// ML-DSA and ML-KEM keys use the "AKP" key type, whose members are the
// algorithm name plus base64url "pub" and (for private keys) "priv" seed.
JSC::JSValue KeyObject::exportJwkAkpKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, CryptoKeyType exportType)
{
    ncrypto::MarkPopErrorOnReturn markPopError;
    VM& vm = lexicalGlobalObject->vm();

    const auto& pkey = m_data->asymmetricKey;
    ASCIILiteral name = pqcNidToKeyTypeName(pkey.id());
    ASSERT(!name.isNull());

    JSObject* jwk = JSC::constructEmptyObject(lexicalGlobalObject);

    jwk->putDirect(vm, Identifier::fromString(vm, "kty"_s), jsNontrivialString(vm, "AKP"_s));
    jwk->putDirect(vm, Identifier::fromString(vm, "alg"_s),
        jsNontrivialString(vm, WTF::String(name).convertToASCIIUppercase()));

    ncrypto::DataPointer publicData = pkey.rawPublicKey();
    if (!publicData) {
        ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to get raw public key"_s);
        return {};
    }
    JSValue encodedPub = JSValue::decode(StringBytes::encode(lexicalGlobalObject, scope, publicData.span(), BufferEncodingType::base64url));
    RETURN_IF_EXCEPTION(scope, {});
    jwk->putDirect(vm, Identifier::fromString(vm, "pub"_s), encodedPub);

    if (exportType == CryptoKeyType::Private) {
        auto seed = getPrivateSeed(pkey);
        if (!seed) {
            ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to get private seed"_s);
            return {};
        }
        JSValue encodedPriv = JSValue::decode(StringBytes::encode(lexicalGlobalObject, scope, seed.span(), BufferEncodingType::base64url));
        RETURN_IF_EXCEPTION(scope, {});
        jwk->putDirect(vm, Identifier::fromString(vm, "priv"_s), encodedPriv);
    }

    return jwk;
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

    default:
        if (isMlDsaNid(m_data->asymmetricKey.id()) || isMlKemNid(m_data->asymmetricKey.id()))
            return exportJwkAkpKey(globalObject, scope, exportType);
        break;
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

static JSValue dataPointerToBuffer(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, ncrypto::DataPointer&& data)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    size_t size = data.size();
    RefPtr<ArrayBuffer> buf = JSC::ArrayBuffer::tryCreateUninitialized(size, 1);
    if (!buf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }
    if (size > 0)
        memcpy(buf->data(), data.get(), size);
    return JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(buf), 0, size);
}

JSC::JSValue KeyObject::exportRaw(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, ncrypto::EVPKeyPointer::PKFormatType format, int ecPointForm)
{
    ASSERT(type() != CryptoKeyType::Secret);

    const ncrypto::EVPKeyPointer& pkey = m_data->asymmetricKey;
    const int id = pkey.id();

    if (format == ncrypto::EVPKeyPointer::PKFormatType::RawPublic) {
        if (id == EVP_PKEY_EC) {
            const EC_KEY* ec = pkey;
            const EC_GROUP* group = ncrypto::ECKeyPointer::GetGroup(ec);
            const EC_POINT* point = ncrypto::ECKeyPointer::GetPublicKey(ec);
            if (group == nullptr || point == nullptr) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to get raw public key"_s);
                return {};
            }
            point_conversion_form_t form = static_cast<point_conversion_form_t>(ecPointForm);
            size_t len = EC_POINT_point2oct(group, point, form, nullptr, 0, nullptr);
            if (len == 0) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to get raw public key"_s);
                return {};
            }
            auto buf = ncrypto::DataPointer::Alloc(len);
            if (!buf) {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            if (EC_POINT_point2oct(group, point, form, static_cast<unsigned char*>(buf.get()), len, nullptr) == 0) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to get raw public key"_s);
                return {};
            }
            return dataPointerToBuffer(globalObject, scope, WTF::move(buf));
        }

        if (id == EVP_PKEY_ED25519 || id == EVP_PKEY_ED448 || id == EVP_PKEY_X25519 || id == EVP_PKEY_X448
            || isMlDsaNid(id) || isMlKemNid(id)) {
            auto raw = pkey.rawPublicKey();
            if (!raw) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to get raw public key"_s);
                return {};
            }
            return dataPointerToBuffer(globalObject, scope, WTF::move(raw));
        }

        ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
        return {};
    }

    if (format == ncrypto::EVPKeyPointer::PKFormatType::RawPrivate) {
        if (type() != CryptoKeyType::Private) {
            ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
            return {};
        }
        if (id == EVP_PKEY_EC) {
            const EC_KEY* ec = pkey;
            const EC_GROUP* group = ncrypto::ECKeyPointer::GetGroup(ec);
            const BIGNUM* priv = ncrypto::ECKeyPointer::GetPrivateKey(ec);
            if (group == nullptr || priv == nullptr) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to export EC private key"_s);
                return {};
            }
            auto order = ncrypto::BignumPointer::New();
            if (!order || !EC_GROUP_get_order(group, order.get(), nullptr)) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to export EC private key"_s);
                return {};
            }
            auto buf = ncrypto::BignumPointer::EncodePadded(priv, order.byteLength());
            if (!buf) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to export EC private key"_s);
                return {};
            }
            return dataPointerToBuffer(globalObject, scope, WTF::move(buf));
        }

        if (id == EVP_PKEY_ED25519 || id == EVP_PKEY_ED448 || id == EVP_PKEY_X25519 || id == EVP_PKEY_X448) {
            auto raw = pkey.rawPrivateKey();
            if (!raw) {
                ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to get raw private key"_s);
                return {};
            }
            return dataPointerToBuffer(globalObject, scope, WTF::move(raw));
        }

        ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
        return {};
    }

    ASSERT(format == ncrypto::EVPKeyPointer::PKFormatType::RawSeed);

    if (type() != CryptoKeyType::Private || !(isMlDsaNid(id) || isMlKemNid(id))) {
        ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
        return {};
    }

    auto seed = getPrivateSeed(pkey);
    if (!seed) {
        ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to get private seed"_s);
        return {};
    }
    return dataPointerToBuffer(globalObject, scope, WTF::move(seed));
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

    return JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(buf), 0, bptr->length);
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
        JSPublicKeyObject* publicKey = JSPublicKeyObject::create(vm, structure, lexicalGlobalObject, WTF::move(keyObject));
        return publicKey;
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
        return exportJwk(lexicalGlobalObject, scope, CryptoKeyType::Public, false);
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::RawPublic || config.format == ncrypto::EVPKeyPointer::PKFormatType::RawPrivate || config.format == ncrypto::EVPKeyPointer::PKFormatType::RawSeed) {
        return exportRaw(lexicalGlobalObject, scope, config.format, config.ec_point_form);
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
        JSPrivateKeyObject* privateKey = JSPrivateKeyObject::create(vm, structure, lexicalGlobalObject, WTF::move(keyObject));
        return privateKey;
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
        return exportJwk(lexicalGlobalObject, scope, CryptoKeyType::Private, false);
    }

    if (config.format == ncrypto::EVPKeyPointer::PKFormatType::RawPublic || config.format == ncrypto::EVPKeyPointer::PKFormatType::RawPrivate || config.format == ncrypto::EVPKeyPointer::PKFormatType::RawSeed) {
        return exportRaw(lexicalGlobalObject, scope, config.format, config.ec_point_form);
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

    if (JSObject* options = dynamicDowncast<JSObject>(optionsValue)) {
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

                RELEASE_AND_RETURN(scope, exportJwk(globalObject, scope, exportType, false));
            }

            if (formatView == "raw-public"_s || formatView == "raw-private"_s || formatView == "raw-seed"_s) {
                if (exportType == CryptoKeyType::Private) {
                    JSValue passphraseValue = options->get(globalObject, Identifier::fromString(vm, "passphrase"_s));
                    RETURN_IF_EXCEPTION(scope, {});
                    if (!passphraseValue.isUndefined()) {
                        ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, formatView, "does not support encryption"_s);
                        return {};
                    }
                }

                ncrypto::EVPKeyPointer::PKFormatType rawFormat;
                if (formatView == "raw-public"_s) {
                    rawFormat = ncrypto::EVPKeyPointer::PKFormatType::RawPublic;
                } else if (formatView == "raw-private"_s) {
                    if (exportType != CryptoKeyType::Private) {
                        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.format"_s, formatValue);
                        return {};
                    }
                    rawFormat = ncrypto::EVPKeyPointer::PKFormatType::RawPrivate;
                } else {
                    if (exportType != CryptoKeyType::Private) {
                        ERR::INVALID_ARG_VALUE(scope, globalObject, "options.format"_s, formatValue);
                        return {};
                    }
                    rawFormat = ncrypto::EVPKeyPointer::PKFormatType::RawSeed;
                }

                int form = POINT_CONVERSION_UNCOMPRESSED;
                if (rawFormat == ncrypto::EVPKeyPointer::PKFormatType::RawPublic && m_data->asymmetricKey.id() == EVP_PKEY_EC) {
                    JSValue typeValue = options->get(globalObject, Identifier::fromString(vm, "type"_s));
                    RETURN_IF_EXCEPTION(scope, {});
                    if (!typeValue.isUndefined()) {
                        auto* typeStr = typeValue.toString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        auto typeView = typeStr->view(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        if (typeView == "compressed"_s) {
                            form = POINT_CONVERSION_COMPRESSED;
                        } else if (typeView != "uncompressed"_s) {
                            ERR::INVALID_ARG_VALUE(scope, globalObject, "options.type"_s, typeValue, "must be one of: 'compressed', 'uncompressed'"_s);
                            return {};
                        }
                    }
                }

                RELEASE_AND_RETURN(scope, exportRaw(globalObject, scope, rawFormat, form));
            }
        }

        JSValue keyType = asymmetricKeyType(globalObject);
        if (exportType == CryptoKeyType::Public) {
            ncrypto::EVPKeyPointer::PublicKeyEncodingConfig config;
            parsePublicKeyEncoding(globalObject, scope, options, keyType, WTF::nullStringView(), config);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, exportPublic(globalObject, scope, config));
        }

        ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig config;
        parsePrivateKeyEncoding(globalObject, scope, options, keyType, WTF::nullStringView(), config);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, exportPrivate(globalObject, scope, config));
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
        return JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTF::move(buf), 0, key.size());
    };

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* options = dynamicDowncast<JSObject>(optionsValue);

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
        if (ASCIILiteral pqcName = pqcNidToKeyTypeName(m_data->asymmetricKey.id()))
            return jsNontrivialString(vm, WTF::String(pqcName));
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

static WebCore::CryptoKeyUsageBitmap toWebCryptoUsageBitmap(const Vector<WebCore::CryptoKeyUsage>& usages)
{
    WebCore::CryptoKeyUsageBitmap bitmap = 0;
    for (auto usage : usages) {
        switch (usage) {
        case WebCore::CryptoKeyUsage::Encrypt:
            bitmap |= WebCore::CryptoKeyUsageEncrypt;
            break;
        case WebCore::CryptoKeyUsage::Decrypt:
            bitmap |= WebCore::CryptoKeyUsageDecrypt;
            break;
        case WebCore::CryptoKeyUsage::Sign:
            bitmap |= WebCore::CryptoKeyUsageSign;
            break;
        case WebCore::CryptoKeyUsage::Verify:
            bitmap |= WebCore::CryptoKeyUsageVerify;
            break;
        case WebCore::CryptoKeyUsage::DeriveKey:
            bitmap |= WebCore::CryptoKeyUsageDeriveKey;
            break;
        case WebCore::CryptoKeyUsage::DeriveBits:
            bitmap |= WebCore::CryptoKeyUsageDeriveBits;
            break;
        case WebCore::CryptoKeyUsage::WrapKey:
            bitmap |= WebCore::CryptoKeyUsageWrapKey;
            break;
        case WebCore::CryptoKeyUsage::UnwrapKey:
            bitmap |= WebCore::CryptoKeyUsageUnwrapKey;
            break;
        case WebCore::CryptoKeyUsage::EncapsulateKey:
            bitmap |= WebCore::CryptoKeyUsageEncapsulateKey;
            break;
        case WebCore::CryptoKeyUsage::EncapsulateBits:
            bitmap |= WebCore::CryptoKeyUsageEncapsulateBits;
            break;
        case WebCore::CryptoKeyUsage::DecapsulateKey:
            bitmap |= WebCore::CryptoKeyUsageDecapsulateKey;
            break;
        case WebCore::CryptoKeyUsage::DecapsulateBits:
            bitmap |= WebCore::CryptoKeyUsageDecapsulateBits;
            break;
        }
    }
    return bitmap;
}

static std::optional<Vector<uint8_t>> marshalAsymmetricKey(const ncrypto::EVPKeyPointer& pkey, bool isPublic)
{
    return WebCore::marshalEVPKey(pkey.get(), isPublic);
}

// KeyObject.prototype.toCryptoKey, following Node's per-algorithm dispatch in
// lib/internal/crypto/keys.js.
JSValue KeyObject::toCryptoKey(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSValue algorithmValue, JSValue extractableValue, JSValue keyUsagesValue)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto algorithm = WebCore::convert<WebCore::IDLUnion<WebCore::IDLObject, WebCore::IDLDOMString>>(*lexicalGlobalObject, algorithmValue);
    RETURN_IF_EXCEPTION(scope, {});
    bool extractable = extractableValue.toBoolean(lexicalGlobalObject);
    auto keyUsages = WebCore::convert<WebCore::IDLSequence<WebCore::IDLEnumeration<WebCore::CryptoKeyUsage>>>(*lexicalGlobalObject, keyUsagesValue);
    RETURN_IF_EXCEPTION(scope, {});
    auto usagesBitmap = toWebCryptoUsageBitmap(keyUsages);

    auto throwDOMException = [&](WebCore::ExceptionCode code, const String& message) -> JSValue {
        WebCore::propagateException(*lexicalGlobalObject, scope, WebCore::Exception { code, message });
        return {};
    };

    auto paramsOrException = WebCore::SubtleCrypto::normalizeImportParameters(*lexicalGlobalObject, WTF::move(algorithm));
    RETURN_IF_EXCEPTION(scope, {});
    if (paramsOrException.hasException()) {
        WebCore::propagateException(*lexicalGlobalObject, scope, paramsOrException.releaseException());
        return {};
    }
    auto params = paramsOrException.releaseReturnValue();
    auto identifier = params->identifier;

    RefPtr<WebCore::CryptoKey> result;
    std::optional<WebCore::ExceptionCode> failureCode;
    String failureMessage;
    auto keyCallback = [&](WebCore::CryptoKey& key) { result = &key; };
    auto exceptionCallback = [&](WebCore::ExceptionCode code, const String& message) {
        failureCode = code;
        failureMessage = message;
    };

    if (type() == CryptoKeyType::Secret) {
        WebCore::CryptoKeyFormat format = WebCore::CryptoKeyFormat::Raw;
        switch (identifier) {
        case CryptoAlgorithmIdentifier::HMAC:
        case CryptoAlgorithmIdentifier::AES_CTR:
        case CryptoAlgorithmIdentifier::AES_CBC:
        case CryptoAlgorithmIdentifier::AES_GCM:
        case CryptoAlgorithmIdentifier::AES_KW:
        case CryptoAlgorithmIdentifier::HKDF:
        case CryptoAlgorithmIdentifier::PBKDF2:
            break;
        case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
            format = WebCore::CryptoKeyFormat::RawSecret;
            break;
        default:
            return throwDOMException(WebCore::NotSupportedError, "Unrecognized algorithm name"_s);
        }

        Vector<uint8_t> keyData;
        keyData.appendVector(symmetricKey());
        auto importAlgorithm = WebCore::CryptoAlgorithmRegistry::singleton().create(identifier);
        importAlgorithm->importKey(format, WebCore::KeyData { WTF::move(keyData) }, *params, extractable, usagesBitmap, WTF::move(keyCallback), WTF::move(exceptionCallback));
    } else {
        bool isPublic = type() == CryptoKeyType::Public;
        switch (identifier) {
        case CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5:
        case CryptoAlgorithmIdentifier::RSA_PSS:
        case CryptoAlgorithmIdentifier::RSA_OAEP:
        case CryptoAlgorithmIdentifier::ECDSA:
        case CryptoAlgorithmIdentifier::ECDH:
        case CryptoAlgorithmIdentifier::Ed25519:
        case CryptoAlgorithmIdentifier::X25519: {
            // Round-trip through DER so the WebCrypto import performs the same
            // validation as importKey.
            auto der = marshalAsymmetricKey(asymmetricKey(), isPublic);
            if (!der)
                return throwDOMException(WebCore::OperationError, ""_s);
            auto importAlgorithm = WebCore::CryptoAlgorithmRegistry::singleton().create(identifier);
            importAlgorithm->importKey(isPublic ? WebCore::CryptoKeyFormat::Spki : WebCore::CryptoKeyFormat::Pkcs8, WebCore::KeyData { WTF::move(*der) }, *params, extractable, usagesBitmap, WTF::move(keyCallback), WTF::move(exceptionCallback));
            break;
        }
        case CryptoAlgorithmIdentifier::ML_DSA_44:
        case CryptoAlgorithmIdentifier::ML_DSA_65:
        case CryptoAlgorithmIdentifier::ML_DSA_87:
        case CryptoAlgorithmIdentifier::ML_KEM_768:
        case CryptoAlgorithmIdentifier::ML_KEM_1024: {
            // Node's 'KeyObject' import path wraps the handle directly.
            WebCore::CryptoKeyUsageBitmap allowedUsages;
            if (WebCore::CryptoKeyAKP::isMlDsa(identifier))
                allowedUsages = isPublic ? WebCore::CryptoKeyUsageVerify : WebCore::CryptoKeyUsageSign;
            else
                allowedUsages = isPublic
                    ? WebCore::CryptoKeyUsageEncapsulateKey | WebCore::CryptoKeyUsageEncapsulateBits
                    : WebCore::CryptoKeyUsageDecapsulateKey | WebCore::CryptoKeyUsageDecapsulateBits;
            if (usagesBitmap & ~allowedUsages)
                return throwDOMException(WebCore::SyntaxError, makeString("Unsupported key usage for a "_s, WebCore::CryptoAlgorithmRegistry::singleton().name(identifier), " key"_s));
            if (EVP_PKEY_id(asymmetricKey().get()) != WebCore::CryptoKeyAKP::nidForIdentifier(identifier))
                return throwDOMException(WebCore::DataError, "Invalid key type"_s);
            EVP_PKEY_up_ref(asymmetricKey().get());
            WebCore::EvpPKeyPtr platformKey(asymmetricKey().get());
            result = WebCore::CryptoKeyAKP::create(identifier, type(), WTF::move(platformKey), extractable, usagesBitmap);
            if (!result)
                return throwDOMException(WebCore::OperationError, ""_s);
            break;
        }
        default:
            return throwDOMException(WebCore::NotSupportedError, "Unrecognized algorithm name"_s);
        }
    }

    if (failureCode)
        return throwDOMException(*failureCode, failureMessage);
    if (!result)
        return throwDOMException(WebCore::OperationError, ""_s);

    if ((result->type() == WebCore::CryptoKeyType::Private || result->type() == WebCore::CryptoKeyType::Secret) && !result->usagesBitmap()) {
        return throwDOMException(WebCore::SyntaxError,
            result->type() == WebCore::CryptoKeyType::Private
                ? "Usages cannot be empty when importing a private key."_s
                : "Usages cannot be empty when importing a secret key."_s);
    }

    return WebCore::toJS(lexicalGlobalObject, globalObject, *result);
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
    return KeyObject(type, WTF::move(data));
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
        return create(WTF::move(copy));
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

        return create(CryptoKeyType::Public, WTF::move(keyPtr));
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

        return create(CryptoKeyType::Private, WTF::move(keyPtr));
    }
    }

    return WebCore::Exception { WebCore::ExceptionCode::CryptoOperationFailedError, "Unknown key type"_s };
}

KeyObject KeyObject::create(WTF::Vector<uint8_t>&& symmetricKey)
{
    RefPtr<KeyObjectData> data = KeyObjectData::create(WTF::move(symmetricKey));
    return KeyObject(CryptoKeyType::Secret, WTF::move(data));
}

KeyObject KeyObject::create(CryptoKeyType type, ncrypto::EVPKeyPointer&& asymmetricKey)
{
    RefPtr<KeyObjectData> data = KeyObjectData::create(WTF::move(asymmetricKey));
    return KeyObject(type, WTF::move(data));
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
    auto* decodedBuf = dynamicDowncast<JSArrayBufferView>(decoded);
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
        Akp,
    };

    Kty kty;
    if (ktyView == "RSA"_s) {
        kty = Kty::Rsa;
    } else if (ktyView == "EC"_s) {
        kty = Kty::Ec;
    } else if (ktyView == "OKP"_s) {
        kty = Kty::Okp;
    } else if (ktyView == "AKP"_s) {
        kty = Kty::Akp;
    } else {
        // validateOneOf
        ERR::INVALID_ARG_VALUE(scope, globalObject, "key.kty"_s, ktyView.owner, "must be one of: 'RSA', 'EC', 'OKP', 'AKP'"_s);
        return {};
    }

    CryptoKeyType keyType = mode == PrepareAsymmetricKeyMode::ConsumePublic || mode == PrepareAsymmetricKeyMode::CreatePublic
        ? CryptoKeyType::Public
        : CryptoKeyType::Private;

    switch (kty) {
    case Kty::Akp: {
        // "AKP" covers the ML-DSA and ML-KEM parameter sets. The parameter set
        // is named by "alg" (matched case-sensitively, e.g. "ML-DSA-44"), the
        // public key lives in "pub", and the private key is the seed in "priv".
        VM& vm = globalObject->vm();
        JSValue algValue = jwk->get(globalObject, Identifier::fromString(vm, "alg"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue pubValue = jwk->get(globalObject, Identifier::fromString(vm, "pub"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue privValue = jwk->get(globalObject, Identifier::fromString(vm, "priv"_s));
        RETURN_IF_EXCEPTION(scope, {});

        int nid = 0;
        if (algValue.isString()) {
            WTF::String algString = algValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            int candidate = pqcKeyTypeToNid(algString.convertToASCIILowercase());
            // Only the canonical upper-case spelling is accepted.
            if (candidate && WTF::String(pqcNidToKeyTypeName(candidate)).convertToASCIIUppercase() == algString)
                nid = candidate;
        }
        if (!nid) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Unsupported JWK AKP \"alg\""_s);
            return {};
        }

        if (!pubValue.isString() || (!privValue.isUndefined() && !privValue.isString())) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK AKP key"_s);
            return {};
        }

        // The JWK itself decides whether private key material is present.
        CryptoKeyType jwkType = privValue.isString() ? CryptoKeyType::Private : CryptoKeyType::Public;
        if (keyType == CryptoKeyType::Private && jwkType == CryptoKeyType::Public) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject, "JWK does not contain private key material"_s);
            return {};
        }

        // pubValue / privValue were already read and type-checked above; decode
        // them directly so each JWK property is observed exactly once.
        auto pubView = asString(pubValue)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto* pubBuf = decodeJwkString(globalObject, scope, pubView, "key.pub"_s);
        RETURN_IF_EXCEPTION(scope, {});

        JSArrayBufferView* privBuf = nullptr;
        if (jwkType == CryptoKeyType::Private) {
            auto privView = asString(privValue)->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            privBuf = decodeJwkString(globalObject, scope, privView, "key.priv"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }

        MarkPopErrorOnReturn markPopError;

        ncrypto::EVPKeyPointer key = jwkType == CryptoKeyType::Private
            ? newFromPrivateSeed(nid, privBuf->span())
            : newFromRawPublic(nid, pubBuf->span());

        if (!key) {
            ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK AKP key"_s);
            return {};
        }

        // "pub" must agree with the public key derived from the seed.
        if (jwkType == CryptoKeyType::Private) {
            auto derivedPub = key.rawPublicKey();
            auto expected = pubBuf->span();
            if (!derivedPub || derivedPub.size() != expected.size()
                || CRYPTO_memcmp(derivedPub.get(), expected.data(), expected.size()) != 0) {
                ERR::CRYPTO_INVALID_JWK(scope, globalObject, "Invalid JWK AKP key"_s);
                return {};
            }
        }

        JSC::ensureStillAliveHere(pubBuf);
        return create(keyType, WTF::move(key));
    }
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

        return create(keyType, WTF::move(key));
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

        return create(keyType, WTF::move(key));
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

        auto key = EVPKeyPointer::NewRSA(WTF::move(rsa));
        return create(keyType, WTF::move(key));
    }
    }

    UNREACHABLE();
}

static bool isUnavailablePqcKeyType(const WTF::String& type)
{
    return type.startsWith("ml-dsa-"_s) || type.startsWith("ml-kem-"_s) || type.startsWith("slh-dsa-"_s);
}

static bool isUnsupportedRawKeyType(const WTF::String& type)
{
    return type == "rsa"_s || type == "rsa-pss"_s || type == "dsa"_s || type == "dh"_s;
}

KeyObject KeyObject::getKeyObjectHandleFromRaw(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const uint8_t> keyData, ncrypto::EVPKeyPointer::PKFormatType format, const WTF::String& asymmetricKeyType, JSValue namedCurveValue)
{
    CryptoKeyType targetType = format == ncrypto::EVPKeyPointer::PKFormatType::RawPublic
        ? CryptoKeyType::Public
        : CryptoKeyType::Private;

    auto throwInvalid = [&]() {
        if (!scope.exception())
            ERR::INVALID_ARG_VALUE(scope, globalObject, "key"_s, jsUndefined(), "Invalid key data"_s);
    };

    int nid = 0;
    if (WTF::equalIgnoringASCIICase(asymmetricKeyType, "ed25519"_s))
        nid = EVP_PKEY_ED25519;
    else if (WTF::equalIgnoringASCIICase(asymmetricKeyType, "ed448"_s))
        nid = EVP_PKEY_ED448;
    else if (WTF::equalIgnoringASCIICase(asymmetricKeyType, "x25519"_s))
        nid = EVP_PKEY_X25519;
    else if (WTF::equalIgnoringASCIICase(asymmetricKeyType, "x448"_s))
        nid = EVP_PKEY_X448;

    // Validate key type / format compatibility (Node's ValidateRawKeyImportFormat).
    if (asymmetricKeyType == "ec"_s || nid != 0) {
        if (format == ncrypto::EVPKeyPointer::PKFormatType::RawSeed) {
            ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
            return {};
        }
    } else if (int pqcNid = pqcKeyTypeToNid(asymmetricKeyType, /* ignoreCase */ true)) {
        nid = pqcNid;
    } else if (isUnavailablePqcKeyType(asymmetricKeyType)) {
        // SLH-DSA and ML-KEM-512 have no EVP_PKEY support in vendored BoringSSL.
        ERR::INVALID_ARG_VALUE(scope, globalObject, "key"_s, jsUndefined(), "Unsupported key type"_s);
        return {};
    } else if (isUnsupportedRawKeyType(asymmetricKeyType)) {
        ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
        return {};
    } else {
        ERR::INVALID_ARG_VALUE(scope, globalObject, "key"_s, jsUndefined(), makeString("Invalid asymmetricKeyType: "_s, asymmetricKeyType));
        return {};
    }

    MarkPopErrorOnReturn markPopError;

    if (asymmetricKeyType == "ec"_s) {
        if (!namedCurveValue.isString()) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "key.namedCurve"_s, "string"_s, namedCurveValue);
            return {};
        }
        WTF::String curveStr = namedCurveValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto curveUtf8 = curveStr.utf8();
        int curveNid = ncrypto::Ec::GetCurveIdFromName(curveUtf8.data());
        if (curveNid == NID_undef) {
            ERR::CRYPTO_INVALID_CURVE(scope, globalObject);
            return {};
        }

        auto eckey = ncrypto::ECKeyPointer::NewByCurveName(curveNid);
        if (!eckey) {
            throwInvalid();
            return {};
        }
        const EC_GROUP* group = eckey.getGroup();

        if (format == ncrypto::EVPKeyPointer::PKFormatType::RawPublic) {
            auto pub = ncrypto::ECPointPointer::New(group);
            if (!pub) {
                throwInvalid();
                return {};
            }
            ncrypto::Buffer<const unsigned char> buffer { .data = keyData.data(), .len = keyData.size() };
            if (!pub.setFromBuffer(buffer, group) || !eckey.setPublicKey(pub)) {
                throwInvalid();
                return {};
            }
        } else {
            auto order = ncrypto::BignumPointer::New();
            if (!order || !EC_GROUP_get_order(group, order.get(), nullptr)) {
                throwInvalid();
                return {};
            }
            if (keyData.size() != order.byteLength()) {
                throwInvalid();
                return {};
            }
            ncrypto::BignumPointer priv(keyData.data(), keyData.size());
            if (!priv || !eckey.setPrivateKey(priv)) {
                throwInvalid();
                return {};
            }
            auto pub = ncrypto::ECPointPointer::New(group);
            if (!pub || !pub.mul(group, priv.get()) || !eckey.setPublicKey(pub)) {
                throwInvalid();
                return {};
            }
        }

        auto pkey = ncrypto::EVPKeyPointer::New();
        if (!pkey.assign(eckey)) {
            throwInvalid();
            return {};
        }
        eckey.release();
        return create(targetType, WTF::move(pkey));
    }

    if (isMlDsaNid(nid) || isMlKemNid(nid)) {
        // These private keys exist only as a seed; there is no raw-private form.
        if (targetType == CryptoKeyType::Private && format != ncrypto::EVPKeyPointer::PKFormatType::RawSeed) {
            ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject);
            return {};
        }
        auto pqcKey = targetType == CryptoKeyType::Private
            ? newFromPrivateSeed(nid, keyData)
            : newFromRawPublic(nid, keyData);
        if (!pqcKey) {
            throwInvalid();
            return {};
        }
        return create(targetType, WTF::move(pqcKey));
    }

    ncrypto::Buffer<const unsigned char> buffer { .data = keyData.data(), .len = keyData.size() };
    auto pkey = targetType == CryptoKeyType::Private
        ? ncrypto::EVPKeyPointer::NewRawPrivate(nid, buffer)
        : ncrypto::EVPKeyPointer::NewRawPublic(nid, buffer);
    if (!pkey) {
        throwInvalid();
        return {};
    }
    return create(targetType, WTF::move(pkey));
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
            config.passphrase = WTF::move(*passphrase);
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

    // Isolate this parse from errors left on the queue by earlier operations;
    // the error we report below must come from this parse alone.
    ClearErrorOnReturn clearErrorOnReturn;

    if (keyType == CryptoKeyType::Private) {
        auto config = getPrivateKeyEncoding(
            globalObject,
            scope,
            formatType,
            encodingType,
            cipher,
            WTF::move(passphrase),
            KeyEncodingContext::Input);
        RETURN_IF_EXCEPTION(scope, {});

        auto res = EVPKeyPointer::TryParsePrivateKey(config, buf);
        if (res) {
            return create(CryptoKeyType::Private, WTF::move(res.value));
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
        WTF::move(passphrase),
        KeyEncodingContext::Input);
    RETURN_IF_EXCEPTION(scope, {});

    if (config.format == EVPKeyPointer::PKFormatType::PEM) {
        auto publicRes = EVPKeyPointer::TryParsePublicKeyPEM(buf);
        if (publicRes) {
            return create(CryptoKeyType::Public, WTF::move(publicRes.value));
        }

        if (publicRes.error.value() == EVPKeyPointer::PKParseError::NOT_RECOGNIZED) {
            auto privateRes = EVPKeyPointer::TryParsePrivateKey(config, buf);
            if (privateRes) {
                return create(CryptoKeyType::Public, WTF::move(privateRes.value));
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
            return create(CryptoKeyType::Public, WTF::move(res.value));
        }

        throwCryptoError(globalObject, scope, res.openssl_error.value_or(0), "Failed to read asymmetric key"_s);
        return {};
    }

    auto res = EVPKeyPointer::TryParsePrivateKey(config, buf);
    if (res) {
        return create(CryptoKeyType::Private, WTF::move(res.value));
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

    if (JSKeyObject* keyObject = dynamicDowncast<JSKeyObject>(keyValue)) {
        auto& handle = keyObject->handle();
        checkKeyObject(handle, keyValue);
        RETURN_IF_EXCEPTION(scope, {});
        return { .keyData = handle.data() };
    }

    if (JSCryptoKey* cryptoKey = dynamicDowncast<JSCryptoKey>(keyValue)) {
        auto& key = cryptoKey->wrapped();
        checkCryptoKey(key, keyValue);
        RETURN_IF_EXCEPTION(scope, {});

        emitCryptoKeyDeprecationWarning(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto keyObject = create(key);
        if (keyObject.hasException()) [[unlikely]] {
            WebCore::propagateException(*globalObject, scope, keyObject.releaseException());
            RELEASE_AND_RETURN(scope, {});
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

            auto* decodedBuf = dynamicDowncast<JSArrayBufferView>(decoded);
            if (!decodedBuf) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string"_s, decoded);
                return {};
            }

            return {
                .keyDataView = { decodedBuf, decodedBuf->span() },
                .formatType = EVPKeyPointer::PKFormatType::PEM,
            };
        }

        if (auto* view = dynamicDowncast<JSArrayBufferView>(keyValue)) {
            return {
                .keyDataView = { view, view->span() },
                .formatType = EVPKeyPointer::PKFormatType::PEM,
            };
        }

        if (auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(keyValue)) {
            auto* buffer = arrayBuffer->impl();
            return {
                .keyDataView = { arrayBuffer, buffer->span() },
                .formatType = EVPKeyPointer::PKFormatType::PEM,
            };
        }
    }

    if (JSObject* keyObj = dynamicDowncast<JSObject>(keyValue)) {
        JSValue dataValue = keyObj->get(globalObject, Identifier::fromString(vm, "key"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue encodingValue = keyObj->get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue formatValue = keyObj->get(globalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (JSKeyObject* keyObject = dynamicDowncast<JSKeyObject>(dataValue)) {
            auto& handle = keyObject->handle();
            checkKeyObject(handle, dataValue);
            RETURN_IF_EXCEPTION(scope, {});
            return { .keyData = handle.data() };
        }

        if (JSCryptoKey* cryptoKey = dynamicDowncast<JSCryptoKey>(dataValue)) {
            auto& key = cryptoKey->wrapped();
            checkCryptoKey(key, dataValue);
            RETURN_IF_EXCEPTION(scope, {});

            emitCryptoKeyDeprecationWarning(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            auto keyObject = create(key);
            if (keyObject.hasException()) [[unlikely]] {
                WebCore::propagateException(*globalObject, scope, keyObject.releaseException());
                RELEASE_AND_RETURN(scope, {});
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

        if (formatView == "raw-public"_s || formatView == "raw-private"_s || formatView == "raw-seed"_s) {
            if ((mode == PrepareAsymmetricKeyMode::ConsumePrivate || mode == PrepareAsymmetricKeyMode::CreatePrivate) && formatView == "raw-public"_s) {
                ERR::INVALID_ARG_VALUE(scope, globalObject, "key.format"_s, formatValue);
                return {};
            }

            if (!dynamicDowncast<JSArrayBufferView>(dataValue) && !dynamicDowncast<JSArrayBuffer>(dataValue)) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, or DataView"_s, dataValue);
                return {};
            }

            JSValue typeValue = keyObj->get(globalObject, Identifier::fromString(vm, "asymmetricKeyType"_s));
            RETURN_IF_EXCEPTION(scope, {});
            V::validateString(scope, globalObject, typeValue, "key.asymmetricKeyType"_s);
            RETURN_IF_EXCEPTION(scope, {});
            auto typeStr = typeValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            JSValue namedCurveValue = jsUndefined();
            if (typeStr == "ec"_s) {
                namedCurveValue = keyObj->get(globalObject, Identifier::fromString(vm, "namedCurve"_s));
                RETURN_IF_EXCEPTION(scope, {});
                V::validateString(scope, globalObject, namedCurveValue, "key.namedCurve"_s);
                RETURN_IF_EXCEPTION(scope, {});
            }

            // Capture the key span only after the last property getter has run, so a user
            // getter that detaches the buffer cannot leave us with a stale pointer.
            std::span<const uint8_t> keySpan;
            if (auto* view = dynamicDowncast<JSArrayBufferView>(dataValue)) {
                keySpan = view->span();
            } else {
                auto* arrayBuffer = uncheckedDowncast<JSArrayBuffer>(dataValue);
                keySpan = arrayBuffer->impl()->span();
            }

            ncrypto::EVPKeyPointer::PKFormatType rawFormat = formatView == "raw-public"_s
                ? ncrypto::EVPKeyPointer::PKFormatType::RawPublic
                : (formatView == "raw-private"_s
                          ? ncrypto::EVPKeyPointer::PKFormatType::RawPrivate
                          : ncrypto::EVPKeyPointer::PKFormatType::RawSeed);

            KeyObject handle = getKeyObjectHandleFromRaw(globalObject, scope, keySpan, rawFormat, typeStr, namedCurveValue);
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
            if (auto* decodedView = dynamicDowncast<JSArrayBufferView>(decoded)) {
                EVPKeyPointer::PrivateKeyEncodingConfig config;
                parseKeyEncoding(globalObject, scope, keyObj, jsUndefined(), isPublic, WTF::nullStringView(), config);
                RETURN_IF_EXCEPTION(scope, {});

                return {
                    .keyDataView = { decodedView, decodedView->span() },
                    .formatType = config.format,
                    .encodingType = config.type,
                    .cipher = config.cipher,
                    .passphrase = WTF::move(config.passphrase),
                };
            }
        }

        if (auto* view = dynamicDowncast<JSArrayBufferView>(dataValue)) {
            EVPKeyPointer::PrivateKeyEncodingConfig config;
            parseKeyEncoding(globalObject, scope, keyObj, jsUndefined(), isPublic, WTF::nullStringView(), config);
            RETURN_IF_EXCEPTION(scope, {});

            return {
                .keyDataView = { view, view->span() },
                .formatType = config.format,
                .encodingType = config.type,
                .cipher = config.cipher,
                .passphrase = WTF::move(config.passphrase),
            };
        }

        if (auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(dataValue)) {
            EVPKeyPointer::PrivateKeyEncodingConfig config;
            parseKeyEncoding(globalObject, scope, keyObj, jsUndefined(), isPublic, WTF::nullStringView(), config);
            RETURN_IF_EXCEPTION(scope, {});

            auto* buffer = arrayBuffer->impl();
            return {
                .keyDataView = { arrayBuffer, buffer->span() },
                .formatType = config.format,
                .encodingType = config.type,
                .cipher = config.cipher,
                .passphrase = WTF::move(config.passphrase),
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
        if (JSKeyObject* keyObject = dynamicDowncast<JSKeyObject>(keyValue)) {
            auto& handle = keyObject->handle();
            if (handle.type() != CryptoKeyType::Secret) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, handle.type(), "secret"_s);
                return {};
            }
            return handle;
        } else if (JSCryptoKey* cryptoKey = dynamicDowncast<JSCryptoKey>(keyValue)) {
            auto& key = cryptoKey->wrapped();
            if (key.type() != CryptoKeyType::Secret) {
                ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, key.type(), "secret"_s);
                return {};
            }
            emitCryptoKeyDeprecationWarning(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
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

        auto* view = dynamicDowncast<JSArrayBufferView>(buffer);
        if (!view) {
            ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, keyValue, "must be a valid encoding"_s);
            return {};
        }

        Vector<uint8_t> copy;
        copy.append(view->span());
        return create(WTF::move(copy));
    }

    // TODO(dylan-conway): avoid copying by keeping the buffer alive
    if (auto* view = dynamicDowncast<JSArrayBufferView>(keyValue)) {
        Vector<uint8_t> copy;
        copy.append(view->span());
        return create(WTF::move(copy));
    }

    // TODO(dylan-conway): avoid copying by keeping the buffer alive
    if (auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(keyValue)) {
        auto* impl = arrayBuffer->impl();
        Vector<uint8_t> copy;
        copy.append(impl->span());
        return create(WTF::move(copy));
    }

    if (bufferOnly) {
        ERR::INVALID_ARG_INSTANCE(scope, globalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, or DataView"_s, keyValue);
    } else {
        ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey"_s, keyValue);
    }

    return {};
}
}
