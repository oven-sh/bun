"use strict";
let n = 0;
Object.defineProperty(require("./symbols.cjs"), "kA", { get() { return Symbol("got " + n++); } });
