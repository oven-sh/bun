
#pragma once

#include "root.h"
#include "helpers.h"

namespace WebCore {

JSC_DECLARE_HOST_FUNCTION(jsStatelessDH);
JSC_DECLARE_HOST_FUNCTION(jsConvertKey);
JSC_DECLARE_HOST_FUNCTION(jsGetCurves);

JSC::JSValue createNodeCryptoBinding(Zig::GlobalObject* globalObject);

} // namespace WebCore
