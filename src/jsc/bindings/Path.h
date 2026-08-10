#pragma once

#include "root.h"
#include "headers-handwritten.h"

// node:path entry points implemented in src/runtime/node/path.rs.
extern "C" {
// path.dirname(path); throws ERR_INVALID_ARG_TYPE if `path` is not a string.
JSC::EncodedJSValue Bun__Path__dirname(JSC::JSGlobalObject*, bool isWindows, JSC::EncodedJSValue path);
// path.join(lhs, rhs) into a new +1 BunString.
void Bun__Path__joinString(bool isWindows, const BunString* lhs, const BunString* rhs, BunString* result);
}
