#pragma once

#include "root.h"
#include <JavaScriptCore/PropertySlot.h>

namespace Bun {

// defineLazyProperties(target, keys, loader): like V8's SetLazyDataProperty, the first read stores loader(key).
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefineLazyProperties);

// The object that holds the loader result for each lazy property of `target`, or null if it has none.
JSC::JSObject* lazyPropertyValues(JSC::VM&, JSC::JSObject* target);

// True if the slot is a lazy property that nothing has read or replaced.
bool isPendingLazyProperty(const JSC::PropertySlot&);

} // namespace Bun
