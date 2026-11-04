"use strict";
let n = 0;
module.exports = { get kA() { return Symbol("a" + n++); }, kB: Symbol("b") };
