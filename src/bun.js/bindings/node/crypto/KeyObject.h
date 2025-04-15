#pragma once

#include "root.h"
#include "ncrypto.h"
#include "ExceptionOr.h"
#include "CryptoKeyType.h"

namespace WebCore {
class CryptoKey;
}

namespace Bun {

struct KeyObjectData : ThreadSafeRefCounted<KeyObjectData> {
    WTF_MAKE_TZONE_ALLOCATED(KeyObjectData);

    KeyObjectData(WTF::Vector<uint8_t>&& symmetricKey)
        : symmetricKey(WTFMove(symmetricKey))
    {
    }

    KeyObjectData(ncrypto::EVPKeyPointer&& asymmetricKey)
        : asymmetricKey(WTFMove(asymmetricKey))
    {
    }

public:
    ~KeyObjectData() = default;

    static RefPtr<KeyObjectData> create(WTF::Vector<uint8_t>&& symmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTFMove(symmetricKey)));
    }

    static RefPtr<KeyObjectData> create(ncrypto::EVPKeyPointer&& asymmetricKey)
    {
        return adoptRef(*new KeyObjectData(WTFMove(asymmetricKey)));
    }

    WTF::Vector<uint8_t> symmetricKey;
    ncrypto::EVPKeyPointer asymmetricKey;
};

class KeyObject {
    WTF_MAKE_TZONE_ALLOCATED(KeyObject);

    KeyObject(WebCore::CryptoKeyType type, RefPtr<KeyObjectData> data)
        : m_type(type)
        , m_data(data)
    {
    }

public:
    KeyObject() = default;
    ~KeyObject() = default;

    static WebCore::ExceptionOr<KeyObject> create(WebCore::CryptoKey&);
    static KeyObject create(WTF::Vector<uint8_t>&& symmetricKey);
    static KeyObject create(WebCore::CryptoKeyType type, ncrypto::EVPKeyPointer&& asymmetricKey);
    // static KeyObject createJwk(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, WebCore::CryptoKeyType type);

    enum class KeyEncodingContext {
        Input,
        Export,
        Generate,
    };

    enum class PrepareAsymmetricKeyMode {
        ConsumePublic,
        ConsumePrivate,
        CreatePublic,
        CreatePrivate,
    };

private:
    // Helpers for `prepareAsymmetricKey`
    static KeyObject getKeyObjectHandleFromJwk(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* jwk, WebCore::CryptoKeyType type, PrepareAsymmetricKeyMode mode);
    static void getKeyObjectFromHandle(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, const KeyObject& handle, PrepareAsymmetricKeyMode mode);

    static ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig getPrivateKeyEncoding(
        JSC::JSGlobalObject*,
        JSC::ThrowScope&,
        ncrypto::EVPKeyPointer::PKFormatType formatType,
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType,
        JSC::GCOwnedDataScope<WTF::StringView> cipherView,
        std::optional<std::span<const uint8_t>> passphrase,
        KeyEncodingContext ctx);

    static void getKeyFormatAndType(
        ncrypto::EVPKeyPointer::PKFormatType formatType,
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType,
        KeyEncodingContext ctx,
        ncrypto::EVPKeyPointer::AsymmetricKeyEncodingConfig& config);

    static KeyObject getPublicOrPrivateKey(
        JSC::JSGlobalObject* globalObject,
        JSC::ThrowScope& scope,
        std::span<const uint8_t> keyData,
        WebCore::CryptoKeyType keyType,
        ncrypto::EVPKeyPointer::PKFormatType formatType,
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType,
        JSC::GCOwnedDataScope<WTF::StringView> cipherView,
        std::optional<std::span<const uint8_t>> passphrase);

public:
    static KeyObject prepareAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, WebCore::CryptoKeyType type, PrepareAsymmetricKeyMode mode);
    static KeyObject preparePrivateKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue, WebCore::CryptoKeyType type);
    static KeyObject preparePublicOrPrivateKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue, WebCore::CryptoKeyType type);
    static KeyObject prepareSecretKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, JSC::JSValue encodingValue, bool bufferOnly = false);

    JSC::JSValue exportJwkEdKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkEcKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkRsaKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkSecretKey(JSC::JSGlobalObject*, JSC::ThrowScope&);
    JSC::JSValue exportJwkAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType, bool handleRsaPss);
    JSC::JSValue exportJwk(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType type, bool handleRsaPss);
    JSC::JSValue exportPublic(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::EVPKeyPointer::PublicKeyEncodingConfig&);
    JSC::JSValue exportPrivate(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig&);
    JSC::JSValue exportAsymmetric(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue optionsValue, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportSecret(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue optionsValue);

    void getRsaKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    void getDsaKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    void getEcKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    // void getDhKeyDetails(JSC::JSGlobalObject* , JSC::ThrowScope& , JSC::JSObject* result);

    JSC::JSValue asymmetricKeyType(JSC::JSGlobalObject*);
    JSC::JSObject* asymmetricKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&);

    std::optional<bool> equals(const KeyObject& other) const;

    inline WebCore::CryptoKeyType type() const { return m_type; }

    const WTF::Vector<uint8_t>& symmetricKey() const { return m_data->symmetricKey; }
    const ncrypto::EVPKeyPointer& asymmetricKey() const { return m_data->asymmetricKey; }
    RefPtr<KeyObjectData> data() const { return m_data; }

private:
    WebCore::CryptoKeyType m_type = WebCore::CryptoKeyType::Secret;
    RefPtr<KeyObjectData> m_data = nullptr;
};

}
