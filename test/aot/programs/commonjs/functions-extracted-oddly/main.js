function row(label, f) {
  let said;
  try {
    said = f();
  } catch (e) {
    said = "threw " + e.name;
  }
  console.log(label + ": " + String(said));
}
const tools = require("./files/tools.js");
const { plain, plain: renamed, missing, storedLate, replaced, absent = () => "the default" } = require("./files/tools.js");
let { plain: reassigned } = require("./files/tools.js");
const { literal } = require("./files/a_literal.js");
const { plain: throughAGetter } = require("./files/re_exports.js");
const { fromTheCycle, seenEarly } = require("./files/cycle_a.js");

row("an export", () => plain(1));
row("under another name", () => renamed(2));
row("the same closure", () => plain === renamed && plain === tools.plain);
row("a name that is not there", () => missing());
row("an export that is stored late", () => storedLate());
tools.storeLate();
row("the copy stays as it was", () => storedLate());
row("the export is there now", () => tools.storedLate());
row("an export that is replaced", () => replaced());
tools.replace();
row("the copy is not replaced", () => replaced());
row("the export is", () => tools.replaced());
row("a default in the pattern", () => absent());
row("a copy before it is stored to", () => reassigned(3));
reassigned = a => "reassigned " + a;
row("a copy that was stored to", () => reassigned(3));
row("module.exports = { .. }", () => literal(4));
row("re-exported through a getter", () => throughAGetter(5));
row("out of a cycle, afterwards", () => fromTheCycle());
row("what the other module of the cycle took out early", () => seenEarly());
