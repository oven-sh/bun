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
    static constexpr WebCore::CryptoKeyType keyTypeForMode(PrepareAsymmetricKeyMode mode)
    {
        return mode == PrepareAsymmetricKeyMode::ConsumePublic || mode == PrepareAsymmetricKeyMode::CreatePublic
            ? WebCore::CryptoKeyType::Public
            : WebCore::CryptoKeyType::Private;
    }

    // Helpers for `importPreparedKey`
    static KeyObject getKeyObjectHandleFromJwk(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* jwk, PrepareAsymmetricKeyMode mode);
    static KeyObject getKeyObjectHandleFromRaw(JSC::JSGlobalObject*, JSC::ThrowScope&, std::span<const uint8_t> keyData, ncrypto::EVPKeyPointer::PKFormatType format, const WTF::String& asymmetricKeyType, JSC::JSValue namedCurveValue);
    static KeyObject getPublicOrPrivateKey(
        JSC::JSGlobalObject* globalObject,
        JSC::ThrowScope& scope,
        std::span<const uint8_t> keyData,
        WebCore::CryptoKeyType keyType,
        ncrypto::EVPKeyPointer::PKFormatType formatType,
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType,
        const EVP_CIPHER* cipher,
        std::optional<ncrypto::DataPointer> passphrase);

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

    // What node's prepareAsymmetricKey() returns: a key argument that is validated and not read yet.
    // It is a key (`keyData`), or the ArrayBufferView, ArrayBuffer or JWK object that holds the key
    // material (`keyDataOwner`), with the buffer that holds the passphrase (`passphraseOwner`). It has
    // no pointer into those cells, so JS may run before `importPreparedKey` reads them.
    struct PreparedAsymmetricKey {
        WTF_FORBID_HEAP_ALLOCATION;

    public:
        std::optional<RefPtr<KeyObjectData>> keyData { std::nullopt };
        JSC::JSValue keyDataOwner {};
        ncrypto::EVPKeyPointer::PKFormatType formatType { ncrypto::EVPKeyPointer::PKFormatType::PEM };
        std::optional<ncrypto::EVPKeyPointer::PKEncodingType> encodingType { std::nullopt };
        const EVP_CIPHER* cipher { nullptr };
        JSC::JSArrayBufferView* passphraseOwner { nullptr };
        // The raw formats only.
        WTF::String asymmetricKeyType {};
        JSC::JSValue namedCurve {};
    };

    // The two steps that turn the key argument of a node:crypto function into a key. The argument is
    // what node's prepareAsymmetricKey() takes: a KeyObject, a CryptoKey, PEM in a string or a buffer,
    // or a { key, format, type, passphrase, encoding } object. `name` is the name of the argument in
    // error messages. A public mode labels the key public, a private mode labels it private. Pass the
    // same `mode` to both steps. A function that takes more than one key prepares every key before it
    // imports any of them, as node does.
    static PreparedAsymmetricKey prepareAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, PrepareAsymmetricKeyMode mode, WTF::ASCIILiteral name);
    static KeyObject importPreparedKey(JSC::JSGlobalObject*, JSC::ThrowScope&, PreparedAsymmetricKey&&, PrepareAsymmetricKeyMode mode);

    // Both steps, for a function that takes one key. ALWAYS_INLINE keeps a call site as cheap as it
    // was with the two steps written out. An out-of-line frame costs 28 instructions for each key.
    ALWAYS_INLINE static KeyObject getAsymmetricKeyFromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue, PrepareAsymmetricKeyMode mode, WTF::ASCIILiteral name = "key"_s)
    {
        auto prepared = prepareAsymmetricKey(globalObject, scope, keyValue, mode, name);
        RETURN_IF_EXCEPTION(scope, {});
        // A KeyObject or a CryptoKey is a key already: there is nothing to import.
        if (prepared.keyData) {
            return create(keyTypeForMode(mode), WTF::move(*prepared.keyData));
        }
        return importPreparedKey(globalObject, scope, WTF::move(prepared), mode);
    }
    ALWAYS_INLINE static KeyObject getPrivateKeyFromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue, WTF::ASCIILiteral name = "key"_s)
    {
        return getAsymmetricKeyFromJS(globalObject, scope, keyValue, PrepareAsymmetricKeyMode::ConsumePrivate, name);
    }
    ALWAYS_INLINE static KeyObject getPublicOrPrivateKeyFromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue keyValue, WTF::ASCIILiteral name = "key"_s)
    {
        return getAsymmetricKeyFromJS(globalObject, scope, keyValue, PrepareAsymmetricKeyMode::ConsumePublic, name);
    }

    static KeyObject prepareSecretKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, JSC::JSValue encodingValue, bool bufferOnly = false);

    JSC::JSValue exportJwkEdKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkEcKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkRsaKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkAkpKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType);
    JSC::JSValue exportJwkSecretKey(JSC::JSGlobalObject*, JSC::ThrowScope&);
    JSC::JSValue exportJwkAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType exportType, bool handleRsaPss);
    JSC::JSValue exportJwk(JSC::JSGlobalObject*, JSC::ThrowScope&, WebCore::CryptoKeyType type, bool handleRsaPss);
    JSC::JSValue exportRaw(JSC::JSGlobalObject*, JSC::ThrowScope&, ncrypto::EVPKeyPointer::PKFormatType format, int ecPointForm);
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
