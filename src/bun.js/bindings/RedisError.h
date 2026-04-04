#pragma once

namespace Bun {
using namespace JSC;

Structure* createRedisErrorStructure(VM& vm, JSGlobalObject* globalObject);
JSObject* createRedisErrorConstructor(VM& vm, JSGlobalObject* globalObject);
JSObject* createRedisErrorInstance(VM& vm, JSGlobalObject* globalObject, JSValue message, WTF::ASCIILiteral code, JSValue options = JSC::jsUndefined());
}
