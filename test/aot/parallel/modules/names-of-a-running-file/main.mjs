// b.cjs requires a.mjs, which calls import() of b.cjs while b.cjs runs. The call waits for the file: the namespace object has what the file exports when its body has returned.
// `bun run` takes the steps of the call inside the require(), and the object keeps the names of that moment.
// Reference: bun build --compile
const names = module => Object.keys(module).filter(name => name !== "module.exports" && name !== "__esModule").sort().join();
const b = await import("./b.cjs");
const a = await import("./a.mjs");
console.log("asked first:", names(b), b.late, b.default.late);
const inner = await globalThis.inner;
console.log("asked while it ran:", names(inner), inner.late, a.fromA);
