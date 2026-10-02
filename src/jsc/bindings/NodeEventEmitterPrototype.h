#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// `EventEmitter.prototype` of node:events. `process` inherits from it, so nearly every program creates it, and
// most never call a method: a method comes from src/js/internal/events/prototype.ts when it is first read. That
// is the only module that a method evaluates. `kCapture` is the key of the default that
// EventEmitter.captureRejections assigns.
JSC::JSObject* createNodeEventEmitterPrototype(JSC::VM&, JSC::JSGlobalObject*, JSC::Symbol* kCapture);

// The `emit` that the prototype starts with. Empty when the module that has it threw.
JSC::JSValue nodeEventEmitterEmit(Zig::GlobalObject*);
// The same, without the evaluation of the module: empty until a method of the prototype was read.
JSC::JSValue nodeEventEmitterEmitIfEvaluated(Zig::GlobalObject*);

// For src/js/node/events.ts and src/js/internal/events/prototype.ts: the prototype, and the two symbols that are
// keys of every emitter. `process` has all three, and these create it.
JSC::JSValue nodeEventEmitterPrototype(Zig::GlobalObject*);
JSC::JSValue nodeEventEmitterShapeModeSymbol(Zig::GlobalObject*);
JSC::JSValue nodeEventEmitterCaptureSymbol(Zig::GlobalObject*);

}
