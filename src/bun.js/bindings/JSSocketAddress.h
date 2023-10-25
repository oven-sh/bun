// The object returned by Bun.serve's .requestIP()
#pragma once
#include "root.h"
#include "JavaScriptCore/JSObjectInlines.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddress {

Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSObject* JSSocketAddress__create(JSGlobalObject* globalObject, JSString* value, int port, bool isIPv6);
