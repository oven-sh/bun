// The require stands in a CommonJS file that code of the entry requires: the statements of the entry have loaded plain.cjs by then.
import "./plain.cjs";
const real = require("./real.cjs");
console.log(globalThis.seen.join(" "), real.kind);
