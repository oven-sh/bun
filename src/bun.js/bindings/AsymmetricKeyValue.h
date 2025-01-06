#include "root.h"

#include "openssl/evp.h"

namespace WebCore {

class CryptoKey;

class AsymmetricKeyValue {
public:
    EVP_PKEY* key = nullptr;
    bool owned = false;

    operator EVP_PKEY*() const { return key; }
    EVP_PKEY* operator*() const { return key; }
    bool operator!() const { return !key; }

    ~AsymmetricKeyValue();
    AsymmetricKeyValue(EVP_PKEY* key, bool owned);
    AsymmetricKeyValue(CryptoKey&);
};

};
