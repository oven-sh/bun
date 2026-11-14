// Three classes ask one layout for their first private name. Every class's brand is field 0, so the first written name is field 1 in each: the three questions fell on one row of the table of places
// and drove each other out: every question went to the run time. The row is chosen by the declaring class too now.
// COUNT: operation:operationAOTPrivateHas <= 20
class Red { #r = 1; static is(o) { return #r in o; } }
class Green { #g = 1; static is(o) { return #g in o; } }
class Blue { #b = 1; static is(o) { return #b in o; } }
class Q { a = 1; }
const all = JSON.parse("[0,0,1,2,3]").map((kind) => (kind === 0 ? new Q() : kind === 1 ? new Red() : kind === 2 ? new Green() : new Blue()));
let yes = 0, no = 0;
for (let turn = 0; turn < 20000; turn++) { const o = all[turn & 1]; if (Red.is(o)) yes++; else no++; if (Green.is(o)) yes++; else no++; if (Blue.is(o)) yes++; else no++; }
for (const o of all) for (const is of [Red.is, Green.is, Blue.is]) { if (is(o)) yes++; else no++; }

console.log("SAID " + yes + " " + no);
