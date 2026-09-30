#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// `EventEmitter.prototype` of node:events. The first call creates it with the methods of
// src/js/builtins/EventEmitterPrototype.ts and defines the `$nodeEvents` globals that those methods read. No
// JavaScript runs. src/js/node/events.ts assigns `constructor` and `emit`.
JSC::JSValue nodeEventEmitterPrototype(Zig::GlobalObject*);

}
