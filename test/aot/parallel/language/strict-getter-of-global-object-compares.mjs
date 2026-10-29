// A strict getter of the global object compares `this` with undefined, and a free name reads it.
Object.defineProperty(globalThis, "readByName", {
  configurable: true,
  get() {
    return this === undefined ? "undefined" : this === globalThis ? "global" : typeof this;
  },
});
console.log(readByName, readByName, globalThis.readByName);
