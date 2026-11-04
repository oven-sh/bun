// A sloppy getter of the global object returns `this`, and a free name reads it.
Object.defineProperty(globalThis, "readByName", {
  configurable: true,
  get: function () {
    return this;
  },
});
console.log(readByName === globalThis, readByName === undefined, globalThis.readByName === globalThis);
var kept = readByName;
console.log(typeof kept);
