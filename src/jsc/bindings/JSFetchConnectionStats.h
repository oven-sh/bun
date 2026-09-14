// The object passed to fetch()'s `onStats` callback.
#pragma once
#include "root.h"
#include "headers.h"

namespace Bun {
namespace JSFetchConnectionStats {

JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace JSFetchConnectionStats
} // namespace Bun
