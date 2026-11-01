// Both files are looked at while their bodies run: one has stored the function and not yet the names, the other has stored nothing.
const early = require("./stores-early.cjs");
const late = require("./stores-late.cjs");
console.log(typeof early, early.marker, early.default === early, early.seen);
console.log(typeof late, late.marker, late.default === late, late.seen);
