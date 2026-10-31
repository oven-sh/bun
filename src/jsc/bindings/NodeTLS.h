#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(getBundledRootCertificates);
JSC_DECLARE_HOST_FUNCTION(loadExtraCACertificates);
JSC_DECLARE_HOST_FUNCTION(getExtraCACertificates);
JSC_DECLARE_HOST_FUNCTION(getSystemCACertificates);
JSC_DECLARE_HOST_FUNCTION(parseCACertificates);
JSC_DECLARE_HOST_FUNCTION(selectServerName);
JSC_DECLARE_HOST_FUNCTION(addBlockedSPKIForTesting);
JSC_DECLARE_HOST_FUNCTION(clearBlockedSPKIsForTesting);

}
