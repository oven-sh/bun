// A cycle of five bare requires, a to e and back to a, with three more requires across it. `step` is 1 while a body runs and 2 when it has ended: each require that closes a cycle sees 1, each that opened a body sees 2.
// STATISTIC: ModulesWithNames >= 5
// STATISTIC: ModulesWithoutState >= 6
const log = require("./log.cjs");
const a = require("./a.cjs");
const e = require("./e.cjs");
const c = require("./c.cjs");
const d = require("./d.cjs");
const b = require("./b.cjs");
log.push("main sees " + [a.step, b.step, c.step, d.step, e.step].join(" "));
console.log(log.join("\n"));
