// b.cjs calls what a.cjs has exported so far, in front of the store into `key`.
const a = require("./a.cjs");
console.log(a.seenByB, a.early({ undefined: "under undefined", [a.key]: "under the symbol" }), a.late({ [a.key]: "late" }));
const again = require("./a.cjs");
console.log(again === a);
