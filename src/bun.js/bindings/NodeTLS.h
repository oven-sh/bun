#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

BUN_DECLARE_HOST_FUNCTION(Bun__canonicalizeIP);
JSC_DECLARE_HOST_FUNCTION(getBundledRootCertificates);
JSC_DECLARE_HOST_FUNCTION(getExtraCACertificates);
JSC_DECLARE_HOST_FUNCTION(getSystemCACertificates);
JSC_DECLARE_HOST_FUNCTION(getDefaultCiphers);
JSC_DECLARE_HOST_FUNCTION(setDefaultCiphers);

}
