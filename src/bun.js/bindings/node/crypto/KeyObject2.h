#pragma once

#include "root.h"
#include "ncrypto.h"
#include "ExceptionOr.h"

namespace WebCore {
class CryptoKey;
}

namespace Bun {

class KeyObject {
    WTF_MAKE_TZONE_ALLOCATED(KeyObject);

public:
    enum class Type : uint8_t {
        Secret = 0,
        Public = 1,
        Private = 2,
    };

    KeyObject() = default;

    KeyObject(WTF::Vector<uint8_t>&& key)
        : m_type(Type::Secret)
        , m_symmetricKey(WTFMove(key))
    {
    }

    KeyObject(WTF::FixedVector<uint8_t>&& key)
        : m_type(Type::Secret)
        , m_symmetricKey(WTFMove(key))
    {
    }

    KeyObject(Type type, ncrypto::EVPKeyPointer&& key)
        : m_type(type)
        , m_asymmetricKey(WTFMove(key))
    {
    }

    static WebCore::ExceptionOr<KeyObject> create(WebCore::CryptoKey&);

    JSC::JSValue exportJWKEdKey(JSC::JSGlobalObject*, JSC::ThrowScope&, Type exportType);
    JSC::JSValue exportJWKEcKey(JSC::JSGlobalObject*, JSC::ThrowScope&, Type exportType);
    JSC::JSValue exportJWKRsaKey(JSC::JSGlobalObject*, JSC::ThrowScope&, Type exportType);
    JSC::JSValue exportJWKSecretKey(JSC::JSGlobalObject*, JSC::ThrowScope&);
    JSC::JSValue exportJWKAsymmetricKey(JSC::JSGlobalObject*, JSC::ThrowScope&, Type exportType, bool handleRsaPss);
    JSC::JSValue exportJWK(JSC::JSGlobalObject*, JSC::ThrowScope&, Type type, bool handleRsaPss);
    JSC::JSValue exportPublic(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::EVPKeyPointer::PublicKeyEncodingConfig&);
    JSC::JSValue exportPrivate(JSC::JSGlobalObject*, JSC::ThrowScope&, const ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig&);
    JSC::JSValue exportAsymmetric(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue optionsValue, Type exportType);
    JSC::JSValue exportSecret(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue optionsValue);

    void getRsaKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    void getDsaKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    void getEcKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* result);
    // void getDhKeyDetails(JSC::JSGlobalObject* , JSC::ThrowScope& , JSC::JSObject* result);

    JSC::JSValue asymmetricKeyType(JSC::JSGlobalObject*);
    JSC::JSObject* asymmetricKeyDetails(JSC::JSGlobalObject*, JSC::ThrowScope&);

    std::optional<bool> equals(const KeyObject& other) const;

    inline Type type() const { return m_type; }

    const WTF::FixedVector<uint8_t>& symmetricKey() const { return m_symmetricKey; }
    const ncrypto::EVPKeyPointer& asymmetricKey() const { return m_asymmetricKey; }

private:
    Type m_type = Type::Secret;
    WTF::FixedVector<uint8_t> m_symmetricKey;
    ncrypto::EVPKeyPointer m_asymmetricKey;
};

}
