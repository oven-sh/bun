"use strict";
const keys = { kA: Symbol("a"), kB: Symbol("b") };
globalThis.between = Object.keys(module.exports).length;
module.exports = keys;
