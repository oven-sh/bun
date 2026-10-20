#pragma once

#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/Structure.h>
#include <span>

namespace WebCore {

// What every wrapper class does once for each global object: it makes its structures, its prototype and its constructor.
// The generator prints that work into each class. It is the same but for a few constants, so in Bun it is here, once, out of line.

JSC::Structure* createDOMStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype, JSC::TypeInfo, const JSC::ClassInfo*, JSC::IndexingType = JSC::NonArray);

// The members from the table, and Symbol.toStringTag.
void finishCreatingDOMPrototype(JSC::VM&, JSC::JSObject& prototype, const JSC::ClassInfo* wrapperClassInfo, std::span<const JSC::HashTableValue>);

// The getter of `Foo.prototype.constructor`.
JSC::EncodedJSValue constructorOfDOMPrototype(JSC::JSGlobalObject*, JSC::EncodedJSValue thisValue, const JSC::ClassInfo* prototypeClassInfo, JSC::JSValue (*getConstructor)(JSC::VM&, const JSC::JSGlobalObject*));

} // namespace WebCore
