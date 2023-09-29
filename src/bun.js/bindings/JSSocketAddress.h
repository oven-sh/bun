// The object returned by Bun.serve's .requestIP()
#pragma once
#include "root.h"
#include "JavaScriptCore/JSObjectInlines.h"

using namespace JSC;

namespace Bun {
namespace JSSocketAddress {

static const NeverDestroyed<String> IPv4 = MAKE_STATIC_STRING_IMPL("IPv4");
static const NeverDestroyed<String> IPv6 = MAKE_STATIC_STRING_IMPL("IPv6");

Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

} // namespace JSSocketAddress
} // namespace Bun

extern "C" JSObject* JSSocketAddress__create(JSGlobalObject* globalObject, JSString* value, int port, bool isIPv6);
