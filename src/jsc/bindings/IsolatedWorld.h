#pragma once

#include "root.h"

#include "DesktopRealm.h"
#include <JavaScriptCore/JSPromise.h>

namespace Bun {
class WebGlobalObject;
}

// A realm whose scripts see the documents of a page through objects of their own. No object of either side gets to the other.
namespace Bun::IsolatedWorld {

bool is(JSC::JSGlobalObject*);
// Null if it is no world.
WebGlobalObject* pageOf(JSC::JSGlobalObject*);
// What an object of a world stands for, or null.
JSC::JSObject* targetOf(JSC::JSObject*);
// Whether it has a counterpart, so that it is not copied.
bool isShared(JSC::JSObject*);
JSC::JSObject* deletedGlobalsOf(JSC::JSGlobalObject* world);

bool resolveUnobserved(JSC::JSGlobalObject*, JSC::JSPromise*, JSC::JSObject*);
// For native code. What it makes for a world has prototypes of the page, whose `then` would get it.
ALWAYS_INLINE void resolve(JSC::JSGlobalObject* realm, JSC::JSPromise* promise, JSC::JSValue value)
{
    if (!value.isObject() || !isDesktopRealm(realm) || !resolveUnobserved(realm, promise, JSC::asObject(value)))
        promise->resolve(realm, realm->vm(), value);
}

// These may throw.
JSC::JSPromise* promiseFor(JSC::JSGlobalObject*, JSC::JSValue);
void enter(WebGlobalObject* world, JSC::JSGlobalObject* page);
// `steps` get the page and the value as it has it. What they throw is for the world.
JSC::JSValue inPage(JSC::JSGlobalObject* world, JSC::JSValue, JSC::JSValue (*steps)(JSC::JSGlobalObject*, JSC::JSValue));
JSC::JSValue toWorld(JSC::JSGlobalObject* world, JSC::JSValue);
JSC::JSValue toPage(JSC::JSGlobalObject* world, JSC::JSValue);
// Empty if there is none.
JSC::JSValue frameAt(JSC::JSGlobalObject* world, unsigned index);
void defineGlobal(JSC::JSGlobalObject* world, JSC::PropertyName, const JSC::HashTableValue& rowOfPage);

}
