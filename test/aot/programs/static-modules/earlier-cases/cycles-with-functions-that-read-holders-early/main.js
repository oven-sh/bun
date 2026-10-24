// A cycle of CommonJS files: what the second sees of the first, and functions of the first that read its `var` and its `const` that hold a require, called too early.
const a = require("./a.js"), b = require("./b.js"), h = require("./hoisted.js");
console.log(a.early, a.late, a.useB(), a.useConst());
console.log(b.sawEarly, b.sawLate, b.called, b.calledConst, b.lateNow());
console.log(h.before, h.after);
