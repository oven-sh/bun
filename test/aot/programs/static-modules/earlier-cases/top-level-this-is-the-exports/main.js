// Stores through top-level `this`, alone, held by a variable, behind a new `module.exports`, and in a nested function.
// `this` at the top of a CommonJS file is the receiver of the call of its body: the object that `exports` held at first. A store to the variable `exports` does not change it, as in Node. Plain Bun writes `exports` in the place of that `this`, so the lines that read `this` behind such a store are stored.
const only = require("./only"), held = require("./held"), replaced = require("./replaced"), nested = require("./nested");
held.later();
console.log(only.a, only.f(), held.b, held.late);
console.log(Object.keys(replaced).join(), replaced.seen, typeof nested, Object.keys(nested).length, globalThis.fromNested);
console.log(require("./reader.mjs").read);
