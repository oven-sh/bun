// The link of a file that an import() loads lays EventEmitter.prototype above the prototype of process, for an import of node:zlib that nothing has read.
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("before:", above());
const late = await import("./late.mjs");
console.log("behind the import():", above());
console.log(late.read(), above());
