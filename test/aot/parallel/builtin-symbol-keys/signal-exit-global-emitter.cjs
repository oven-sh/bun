// The first lines of the package signal-exit: a registered symbol held in a constant, read and defined on the global object inside a constructor.
const kExitEmitter = Symbol.for("signal-exit emitter");
const global = globalThis;
const ObjectDefineProperty = Object.defineProperty.bind(Object);
class Emitter {
  constructor() {
    if (global[kExitEmitter]) {
      return global[kExitEmitter];
    }
    ObjectDefineProperty(global, kExitEmitter, { value: this, writable: false, enumerable: false, configurable: false });
  }
}
console.log(new Emitter() === new Emitter());
