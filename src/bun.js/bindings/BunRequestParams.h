#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/CallFrame.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// Parse query string into Rails-style nested object
JSC::JSObject* parseQueryParams(JSC::JSGlobalObject* globalObject, const WTF::String& queryString);

// Parse URL and extract query params into Rails-style nested object
JSC::JSObject* parseURLQueryParams(JSC::JSGlobalObject* globalObject, const WTF::String& urlString);

// Export for testing
JSC_DECLARE_HOST_FUNCTION(jsBunParseQueryParams);
extern "C" JSC::EncodedJSValue Bun__parseQueryParams(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

} // namespace Bun