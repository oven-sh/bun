// The first lines of the package signal-exit, with every constant captured by the class.
function outer() {
  const key = Symbol.for("made.up.emitter");
  const g = globalThis;
  const define = Object.defineProperty.bind(Object);
  return class Emitter {
    constructor() {
      if (g[key]) return g[key];
      define(g, key, { value: this, writable: false, enumerable: false, configurable: false });
    }
  };
}
const Emitter = outer();
console.log(new Emitter() === new Emitter());
