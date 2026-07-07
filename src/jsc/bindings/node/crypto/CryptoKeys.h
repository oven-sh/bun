#pragma once

#include "root.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsCreateSecretKey);
JSC_DECLARE_HOST_FUNCTION(jsCreatePublicKey);
JSC_DECLARE_HOST_FUNCTION(jsCreatePrivateKey);

} // namespace Bun
