#pragma once

#include "root.h"

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

// These may throw.
void enter(WebGlobalObject* world, JSC::JSGlobalObject* page);
// `steps` get the page and the value as it has it. What they throw is for the world.
JSC::JSValue inPage(JSC::JSGlobalObject* world, JSC::JSValue, JSC::JSValue (*steps)(JSC::JSGlobalObject*, JSC::JSValue));
JSC::JSValue toWorld(JSC::JSGlobalObject* world, JSC::JSValue);
JSC::JSValue toPage(JSC::JSGlobalObject* world, JSC::JSValue);
// Empty if there is none.
JSC::JSValue frameAt(JSC::JSGlobalObject* world, unsigned index);
void defineGlobal(JSC::JSGlobalObject* world, JSC::PropertyName, const JSC::HashTableValue& rowOfPage);

}
