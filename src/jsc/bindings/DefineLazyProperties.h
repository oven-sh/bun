#pragma once

#include "root.h"

namespace Bun {

// defineLazyProperties(target, keys, loader): CustomValue data properties whose first read
// stores loader(key). The JSC counterpart of V8's SetLazyDataProperty.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefineLazyProperties);

} // namespace Bun
