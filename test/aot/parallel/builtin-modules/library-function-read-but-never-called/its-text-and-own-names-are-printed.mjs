import Module from "node:module";
const held = Module._initPaths;
console.log(typeof held, JSON.stringify(held.name), held.length);
console.log("text:", Function.prototype.toString.call(held).slice(0, 40));
console.log("own names:", Object.getOwnPropertyNames(held).sort().join());
console.log("the same twice:", held === Module._initPaths);
