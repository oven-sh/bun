#pragma once

#include "root.h"
#include "ncrypto.h"
#include "ExceptionOr.h"

namespace WebCore {
class CryptoKey;
}

namespace Bun {

enum class KeyObjectType : uint8_t {
    Secret = 0,
    Public = 1,
    Private = 2,
};

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

    KeyObject(KeyObjectType type, RefPtr<KeyObjectData> data)
        : m_type(type)
        , m_data(data)
    {
    }

public:
    KeyObject() = default;
    ~KeyObject() = default;

    static WebCore::ExceptionOr<KeyObject> create(WebCore::CryptoKey&);
    static KeyObject create(WTF::Vector<uint8_t>&& symmetricKey)
    {
        RefPtr<KeyObjectData> data = KeyObjectData::create(WTFMove(symmetricKey));
        return KeyObject(KeyObjectType::Secret, WTFMove(data));
    }
    static KeyObject create(KeyObjectType type, ncrypto::EVPKeyPointer&& asymmetricKey)
    {
        RefPtr<KeyObjectData> data = KeyObjectData::create(WTFMove(asymmetricKey));
        return KeyObject(type, WTFMove(data));
    }

    enum class PrepareAsymmetricKeyMode {
        ConsumePublic,
        ConsumePrivate,
        CreatePublic,
        CreatePrivate,
    };

    static KeyObject prepareAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue keyValue, KeyObjectType type, PrepareAsymmetricKeyMode mode);

    JSC::JSValue exportJWKEdKey(JSC::JSGlobalObject*, JSC::ThrowScope&, KeyObjectType exportType);
    JSC::JSValue exportJWKEcKey(JSC::JSGlobalObject*, JSC::ThrowScope&, KeyObjectType exportType);
    JSC::JSValue exportJWKRsaKey(JSC::JSGlobalObject*, JSC::ThrowScope&, KeyObjectType exportType);
    JSC::JSValue exportJWKSecretKey(JSC::JSGlobalObject*, JSC::ThrowScope&);
    JSC::JSValue exportJWKAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, KeyObjectType exportType, bool handleRsaPss);
    JSC::JSValue exportJWK(JSC::JSGlobalObject*, JSC::ThrowScope&, KeyObjectType type, bool handleRsaPss);
    JSC::JSValue exportPublic(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::EVPKeyPointer::PublicKeyEncodingConfig&);
    JSC::JSValue exportPrivate(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig&);
    JSC::JSValue exportAsymmetric(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue optionsValue, KeyObjectType exportType);
    JSC::JSValue exportSecret(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue optionsValue);

    void getRsaKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    void getDsaKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    void getEcKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    // void getDhKeyDetails(JSC::JSGlobalObject* , JSC::ThrowScope& , JSC::JSObject* result);

    JSC::JSValue asymmetricKeyType(JSC::JSGlobalObject*);
    JSC::JSObject* asymmetricKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&);

    std::optional<bool> equals(const KeyObject& other) const;

    inline KeyObjectType type() const { return m_type; }

    const WTF::Vector<uint8_t>& symmetricKey() const { return m_data->symmetricKey; }
    const ncrypto::EVPKeyPointer& asymmetricKey() const { return m_data->asymmetricKey; }
    RefPtr<KeyObjectData> data() const { return m_data; }

private:
    KeyObjectType m_type = KeyObjectType::Secret;
    RefPtr<KeyObjectData> m_data = nullptr;
};

}
