
#pragma once

#include "root.h"
#include "helpers.h"
#include "ExceptionOr.h"

namespace WebCore {

ExceptionOr<Vector<uint8_t>> KeyObject__GetBuffer(JSC::JSValue bufferArg);
JSC::JSValue createKeyObjectBinding(Zig::GlobalObject* globalObject);

} // namespace WebCore
