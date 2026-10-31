// A sloppy setter of the global object keeps `this`, and an assignment to a free name calls it.
var kept = [];
Object.defineProperty(globalThis, "storedByName", {
  configurable: true,
  set: function (value) {
    kept.push(this);
  },
});
storedByName = 1;
storedByName = 2;
globalThis.storedByName = 3;
console.log(kept.map(value => (value === globalThis ? "global" : typeof value)).join());
