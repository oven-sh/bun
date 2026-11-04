// Which mentions of a module object lead to the objects of other files. ONE DEED: a file lays a getter under `exports` of its module object: each require answers another object.
"use strict";
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
globalThis.holder = { Thing };
const made = new globalThis.holder.Thing(1, 2);
console.log(Reflect.ownKeys(made).map(String).join(), made[kA], made[kB]);
const one = require("./given.cjs"), other = require("./given.cjs");
console.log(one === other, one.hello(), Object.getPrototypeOf(one) === Object.getPrototypeOf(other));
