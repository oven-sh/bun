#pragma once

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmArgon2Params.h"
#include "JSDOMConvertDictionary.h"

namespace WebCore {

template<> CryptoAlgorithmArgon2Params convertDictionary<CryptoAlgorithmArgon2Params>(JSC::JSGlobalObject&, JSC::JSValue);

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
