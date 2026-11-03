// `import defer * as` of a module whose ordinary namespace object already exists, because the namespace of a module with `export * as` of it was created first: the deferred namespace is another object, and the first read through it evaluates the module.
import defer * as reexporter from "./reexporter.mjs";
import defer * as target from "./target.mjs";
console.log("main runs");
const held = reexporter;
console.log(Object.prototype.toString.call(held), Object.prototype.toString.call(target));
console.log(target.value);
console.log(held.inner === target, Object.prototype.toString.call(held.inner), held.inner.value);
