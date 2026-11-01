import Module from "node:module";
const held = Module._initPaths;
console.log(typeof held, held.name, held.length);
