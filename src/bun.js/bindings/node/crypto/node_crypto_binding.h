
#pragma once

#include "root.h"
#include "helpers.h"
#include "ncrypto.h"

using namespace Bun;
using namespace JSC;

namespace WebCore {

JSC::JSValue createNodeCryptoBinding(Zig::GlobalObject* globalObject);

} // namespace WebCore
