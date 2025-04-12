#pragma once

#include "root.h"
#include "ncrypto.h"

class KeyObject {
    WTF_MAKE_TZONE_ALLOCATED(KeyObject);

public:
    enum class Type {
        Secret = 0,
        Public,
        Private,
    };

    KeyObject() = default;

    KeyObject(WTF::Vector<uint8_t>&& key)
        : m_type(Type::Secret)
        , m_symmetricKey(WTFMove(key))
    {
    }

    KeyObject(Type type, ncrypto::EVPKeyPointer&& key)
        : m_type(type)
        , m_asymmetricKey(WTFMove(key))
    {
    }

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

    Type m_type;
    WTF::FixedVector<uint8_t> m_symmetricKey;
    ncrypto::EVPKeyPointer m_asymmetricKey;
};
