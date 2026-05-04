
#pragma once

#include "root.h"
#include "helpers.h"
#include "ncrypto.h"

namespace Bun {

JSC::JSValue createNodeCryptoBinding(Zig::GlobalObject* globalObject);

} // namespace Bun
