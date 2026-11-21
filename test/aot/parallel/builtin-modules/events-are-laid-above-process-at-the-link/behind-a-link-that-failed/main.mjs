// A file whose link fails by a name that node:os lacks has loaded node:zlib all the same: EventEmitter.prototype lies above the prototype of process behind the failure.
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("before:", above());
await import("./bad.mjs").then(
  () => console.log("bad.mjs is loaded"),
  error => console.log(error.name + ": " + error.message),
);
console.log("behind the link that failed:", above());
