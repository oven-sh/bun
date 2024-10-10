// The object returned by Bun.serve's .requestIP()
#pragma once
#include "root.h"
#include "JavaScriptCore/JSObjectInlines.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddress {

Structure* createStructure(VM& vm, JSGlobalObject* globalObject);
JSObject* create(Zig::GlobalObject* globalObject, JSString* value, int port, bool isIPv6);

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSObject* JSSocketAddress__create(Zig::GlobalObject* globalObject, JSString* value, int port, bool isIPv6);
