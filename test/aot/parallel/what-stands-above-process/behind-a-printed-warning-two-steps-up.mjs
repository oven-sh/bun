// The climb only compares what it finds: it reads no member.
console.log("before", Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype);
process.emitWarning("made-up words");
await new Promise(resolve => setImmediate(resolve));
const above = Reflect.getPrototypeOf(process);
console.log(
  "behind",
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype,
  Object.getPrototypeOf(above) === Object.prototype,
);
console.log(Object.getOwnPropertySymbols(Object.getPrototypeOf(above)).length);
