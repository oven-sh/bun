"use strict";
const base = { kA: Symbol("base a"), kB: Symbol("base b") };
module.exports = { ...base, ["k" + "A"]: Symbol("a") };
