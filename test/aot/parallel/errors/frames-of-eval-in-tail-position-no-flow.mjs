// Flags: --aot-disable=flow-results
// `return (0, eval)("look()")`: the function leaves, `eval` stays on the stack while the source runs.
const names = error => String(error.stack).split("\n").slice(1, 6).map(line => line.trim().replace(/\(?[^ (]*[\\/]/, "(")).join(" < ");
globalThis.look = () => { console.log(names(new Error("x"))); return 1; };
function last() { return (0, eval)("look()"); }
function notLast() { const r = (0, eval)("look()"); return r + r; }
function throughVariable() { const evaluate = eval; return evaluate("look()"); }
function eitherArm(first) { return first ? (0, eval)("look()") : (0, eval)("look() + 1"); }
const arrow = () => (0, eval)("look()");
function throws() { return (0, eval)("null.x"); }
for (const run of [last, notLast, throughVariable, () => eitherArm(true), () => eitherArm(false), arrow]) console.log(run());
try { throws(); } catch (error) { console.log(names(error)); }
