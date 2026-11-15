// The key is a constant of the module, and a function reads it through the check of its temporal dead zone.
const key = Symbol.for("made.up");
const g = globalThis;
function read() { return g[key]; }
console.log(read());
