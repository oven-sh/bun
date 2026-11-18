#pragma once

#include "root.h"

#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace WebCore {
class Blob;
class DOMFormData;
class EventTarget;
}

namespace Bun {

// The realm of a web page in `bun:desktop/electron`: a global object of its own on this thread, whose modules are
// named by URL.

bool desktopRealmHandlesUncaughtException(JSC::JSGlobalObject*, JSC::JSValue error);
// For a URL whose origin is otherwise opaque. Empty in any other realm.
JSC::JSValue desktopRealmOriginOf(JSC::JSGlobalObject*, const String& href);

void desktopRealmTrackRejection(JSC::JSGlobalObject*, JSC::JSPromise*, JSC::JSPromiseRejectionOperation);
inline bool isDesktopRealm(JSC::JSGlobalObject* globalObject)
{
    return globalObject->globalObjectMethodTable()->promiseRejectionTracker == &desktopRealmTrackRejection;
}
// `thrown` is an exception, the value that was thrown last, or empty for what is running.
Vector<JSC::StackFrame> stackOf(JSC::JSGlobalObject*, JSC::JSValue thrown, size_t depth = 64);
JSC::LineColumn placeOf(const JSC::StackFrame&);
// What the prototype of WebCore's class inherits from: in a window or a worker, that of the interface with the same name.
JSC::JSObject* desktopRealmPrototypeAbove(JSC::JSGlobalObject*, ASCIILiteral name);
// Its constructor. Null in other realms.
JSC::JSObject* desktopRealmInterface(JSC::JSGlobalObject*, ASCIILiteral name);
// Empty unless it is an event of a document, or if it has thrown.
JSC::JSValue desktopRealmDispatch(JSC::JSGlobalObject*, WebCore::EventTarget&, JSC::JSValue event);
JSC::EncodedJSValue desktopRealmCreateObjectURL(JSC::JSGlobalObject*, JSC::JSValue blob);
void desktopRealmRevokeObjectURL(JSC::JSGlobalObject*, const String&);
// The plain object that stands for a platform object in a structured clone. Null for any other object.
JSC::JSObject* desktopRealmSerialize(JSC::JSGlobalObject*, JSC::JSObject*, bool isForStorage);
// `reifyStaticPropertyTable`, without what only Bun has. False if the web has the class as it is.
bool desktopRealmReifyMembersOfWeb(const JSC::ClassInfo*, std::span<const JSC::HashTableValue>, JSC::JSObject&);
// In the realm of a page, a File has a prototype of its own.
void desktopRealmAdoptFile(JSC::JSGlobalObject*, JSC::JSValue blob);
JSC::JSValue desktopRealmDeserialize(JSC::JSGlobalObject*, JSC::JSObject* serialized);

// `new FormData(form, submitter)`
void desktopRealmFillFormData(JSC::JSGlobalObject*, JSC::JSValue data, JSC::JSValue form, JSC::JSValue submitter);
// https://html.spec.whatwg.org/#create-an-entry. `name` is there if none was given.
void desktopRealmTurnIntoFile(JSC::JSGlobalObject*, JSC::JSValue given, WebCore::Blob&, String* name);
// The files are objects of their own.
void copyEntriesToAnotherRealm(const WebCore::DOMFormData& from, WebCore::DOMFormData& to);

} // namespace Bun
