// Reference: bun build --compile
// Which mentions of a module object lead to the objects of other files. ONE DEED: a file stores other exports into whatever entries the table has, and a new entry.
"use strict";
require("./symbols.cjs");
require("./meddles.cjs");
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
globalThis.holder = { Thing };
const made = new globalThis.holder.Thing(1, 2);
console.log(Reflect.ownKeys(made).map(String).join(), made[kA], made[kB]);
