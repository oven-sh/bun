// Which mentions of a module object lead to the objects of other files. ONE DEED: what Object.defineProperty() answers, the module object, is kept and read.
"use strict";
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
globalThis.holder = { Thing };
const made = new globalThis.holder.Thing(1, 2);
console.log(Reflect.ownKeys(made).map(String).join(), made[kA], made[kB]);
console.log(require("./given.cjs"), globalThis.seen);
