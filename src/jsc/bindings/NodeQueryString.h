#pragma once

#include "root.h"

namespace Bun {

// querystring.parse(qs, "&", "=", { maxKeys }) with the default decoder.
// Returns undefined when a part has a malformed %XX escape, so that the JS
// loop in querystring.ts runs the unescapeBuffer fallback for it.
JSC_DECLARE_HOST_FUNCTION(jsFunctionParseQueryString);

// decodeURIComponent(s), with undefined in place of the URIError.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDecodeQueryStringComponent);

} // namespace Bun
