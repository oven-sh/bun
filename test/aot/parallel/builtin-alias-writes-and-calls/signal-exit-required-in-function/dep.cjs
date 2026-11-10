const kExitEmitter = Symbol.for("made.up exit emitter");
const global = globalThis;
const ObjectDefineProperty = Object.defineProperty.bind(Object);
class Emitter {
  id = 1;
  constructor() {
    if (global[kExitEmitter]) {
      return global[kExitEmitter];
    }
    ObjectDefineProperty(global, kExitEmitter, {
      value: this,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}
exports.same = () => new Emitter() === new Emitter();
