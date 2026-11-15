"use strict";
const keys = { kA: Symbol("a"), kB: Symbol("b"), renew() { keys.kA = Symbol("renewed"); } };
module.exports = keys;
