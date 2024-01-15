#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

namespace WebCore {

JSC_DECLARE_HOST_FUNCTION(jsReadable_maybeReadMore);
JSC_DECLARE_HOST_FUNCTION(jsReadable_resume);
JSC_DECLARE_HOST_FUNCTION(jsReadable_emitReadable);
JSC_DECLARE_HOST_FUNCTION(jsReadable_onEofChunk);
JSC_DECLARE_HOST_FUNCTION(jsReadable_emitReadable_);

JSC::JSValue createNodeStreamBinding(Zig::GlobalObject* globalObject);

} // namespace WebCore
