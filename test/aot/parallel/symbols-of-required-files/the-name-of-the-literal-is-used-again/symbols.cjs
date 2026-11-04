"use strict";
const keys = { kA: Symbol("a"), kB: Symbol("b") };
module.exports = keys;
keys.kA = Symbol("later");
