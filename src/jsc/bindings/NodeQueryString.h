#pragma once

#include "root.h"

namespace Bun {

// querystring.parse(qs, "&", "=", { maxKeys }); undefined when a malformed escape needs the JS fallback.
JSC_DECLARE_HOST_FUNCTION(jsFunctionParseQueryString);

// decodeURIComponent(s), with undefined in place of the URIError.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDecodeQueryStringComponent);

} // namespace Bun
