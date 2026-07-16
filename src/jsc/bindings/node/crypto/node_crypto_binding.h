
#pragma once

#include "root.h"
#include "helpers.h"
#include "ncrypto.h"

namespace Bun {

JSC::JSValue createNodeCryptoBinding(Bun::GlobalObject* globalObject);

} // namespace Bun
