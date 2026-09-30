#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// The state of node:events that no emitter holds. A global has one set of these values, created with
// EventEmitter.prototype: own properties of the global object under private names, which JS reads as `$nodeEvents`
// followed by the name here (`$nodeEventsKCapture`).
enum class NodeEventEmitterState : uint8_t {
    // A number: 10 until events.defaultMaxListeners or events.setMaxListeners(n) assigns it.
    DefaultMaxListeners,
    // Symbol("kCapture")
    KCapture,
    // Symbol("shapeMode")
    KShapeMode,
    // Symbol.for("events.errorMonitor")
    KErrorMonitor,
    // Symbol.for("nodejs.rejection")
    KRejection,
    // The `emit` that every emitter that captures rejections has as an own property. The first read creates it.
    EmitWithRejectionCapture,
};

// One of those values, for native code. Creates the state when the global does not have it yet. Empty when
// creating EmitWithRejectionCapture threw.
JSC::JSValue nodeEventEmitterState(Zig::GlobalObject*, NodeEventEmitterState);

// `EventEmitter.prototype` of node:events, created with the state by the first call. Only reading `constructor` evaluates a module.
JSC::JSObject* nodeEventEmitterPrototype(Zig::GlobalObject*);

// The same object for src/js/node/events.ts, with every method an own property in node:events' order. Empty when creating `emit` threw.
JSC::JSValue nodeEventEmitterPrototypeForModule(Zig::GlobalObject*);

// A new object like the prototype, from which nothing has read a method.
JSC::JSObject* createNodeEventEmitterPrototype(Zig::GlobalObject*);

}
