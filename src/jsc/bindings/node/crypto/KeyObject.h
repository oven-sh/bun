#pragma once

#include "root.h"
#include "ncrypto.h"
#include "ExceptionOr.h"
#include "CryptoKeyType.h"
#include "KeyObjectData.h"

namespace WebCore {
class CryptoKey;
}

namespace Bun {

class KeyObject {
    WTF_MAKE_TZONE_ALLOCATED(KeyObject);

    KeyObject(WebCore::CryptoKeyType type, RefPtr<KeyObjectData>&& data)
        : m_data(WTF::move(data))
        , m_type(type)
    {
    }

public:
    KeyObject() = default;
    ~KeyObject() = default;

    static WebCore::ExceptionOr<KeyObject> create(WebCore::CryptoKey&);
    static KeyObject create(WTF::Vector<uint8_t>&& symmetricKey);
    static KeyObject create(WebCore::CryptoKeyType type, ncrypto::EVPKeyPointer&& asymmetricKey);
    static KeyObject create(WebCore::CryptoKeyType type, RefPtr<KeyObjectData>&& data);
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
    static KeyObject getKeyObjectHandleFromJwk(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* jwk, PrepareAsymmetricKeyMode mode);
    static void getKeyObjectFromHandle(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, const KeyObject& handle, PrepareAsymmetricKeyMode mode);

public:
    static ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig getPrivateKeyEncoding(
        JSC::JSGlobalObject*,
        JSC::ThrowScope&,
        ncrypto::EVPKeyPointer::PKFormatType formatType,
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType,
        const EVP_CIPHER* cipher,
        std::optional<ncrypto::DataPointer> passphrase,
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
        const EVP_CIPHER* cipher,
        std::optional<ncrypto::DataPointer> passphrase);

    struct PrepareAsymmetricKeyResult {
        std::optional<RefPtr<KeyObjectData>> keyData { std::nullopt };
        JSC::GCOwnedDataScope<std::span<const uint8_t>> keyDataView { nullptr, {} };
        ncrypto::EVPKeyPointer::PKFormatType formatType;
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType { std::nullopt };
        const EVP_CIPHER* cipher { nullptr };
        std::optional<ncrypto::DataPointer> passphrase = { std::nullopt };
    };

    static PrepareAsymmetricKeyResult prepareAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, PrepareAsymmetricKeyMode mode);
    static PrepareAsymmetricKeyResult preparePrivateKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue);
    static PrepareAsymmetricKeyResult preparePublicOrPrivateKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue);
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
    JSC::JSValue toCryptoKey(JSC::JSGlobalObject*, JSC::ThrowScope&,
        JSC::JSValue algorithmValue, JSC::JSValue extractableValue, JSC::JSValue keyUsagesValue);

    inline WebCore::CryptoKeyType type() const { return m_type; }
    inline WebCore::CryptoKeyType& type() { return m_type; }
    const WTF::Vector<uint8_t>& symmetricKey() const { return m_data->symmetricKey; }
    const ncrypto::EVPKeyPointer& asymmetricKey() const { return m_data->asymmetricKey; }
    RefPtr<KeyObjectData> data() const { return m_data; }

private:
    RefPtr<KeyObjectData> m_data = nullptr;
    WebCore::CryptoKeyType m_type = WebCore::CryptoKeyType::Secret;
};

}
