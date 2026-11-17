#pragma once

#include "root.h"

// The main realm of a thread does not trust the realms of pages, and neither has objects of the other. What crosses is copied,
// a function or a promise is made anew, and anything else is a handle without properties until it is back on its side.
namespace Bun::RealmBridge {

// It may throw.
JSC::JSValue cross(JSC::JSGlobalObject* to, JSC::JSValue);
// What a handle stands for. Any other value is returned as it is.
JSC::JSValue peek(JSC::JSValue);
// Also what an error is a copy of.
JSC::JSValue originalOf(JSC::JSValue thrown);

}

namespace Bun {

// (value, isTheSameEachTime?): a handle, for what is not to be copied.

}
