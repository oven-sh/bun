// answers: with-library
// # an await of a number, a record, an instance or a list takes its turn of the job queue and gives the value itself. If a turn were skipped while other jobs wait, if a `then` that came later, from above, from a getter or onto a list were passed by, or if what lives over the await came back changed, the log would differ
// # f1 = note, f2 = numbers, f3 = records
// # RUN(FORM): walk f2:CoroutineBody mechanisms=all
// # FORM-LABEL: code f2:CoroutineBody
// # FORM: = AwaitMayContinue
// # RUN(RECORD): walk f3:CoroutineBody mechanisms=all
// # RECORD-LABEL: code f3:CoroutineBody
// # RECORD: = AwaitMayContinue
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 52 of 52 of 52
// # CHECK-NEXT: exited with 0
const log = [];
function note(text) { log[log.length] = text; }
class Point { constructor(x) { this.x = x; } }
class Later { constructor(x) { this.x = x; } then(resolve) { note("then of Later " + this.x); resolve(this.x * 100); } }
async function numbers(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { sum += await i; note(name + " " + sum); } return sum; }
async function records(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { const held = await { x: i }; sum += held.x; note(name + " " + sum); } return sum; }
async function points(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { const held = await new Point(i); sum += held.x; note(name + " " + sum); } return sum; }
async function lists(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { const held = await [i, i + 1]; sum += held[1]; note(name + " " + sum); } return sum; }
async function once(name) { const held = await { x: 7 }; note(name + " " + held.x); return held.x; }
async function same(name) { const made = { x: 1 }; const held = await made; note(name + " " + (held === made)); return held === made; }
async function thenables(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { sum += await { x: i, then(resolve) { note(name + " then " + this.x); resolve(this.x * 10); } }; note(name + " " + sum); } return sum; }
async function laters(name, turns) { let sum = 0; for (let i = 1; i <= turns; i++) { sum += await new Later(i); note(name + " " + sum); } return sum; }
async function named(name, turns) { let sum = 0; for (let i = 0; i < turns; i++) { const made = { y: i }; if (i === 1) made.then = resolve => { note(name + " then that came later"); resolve({ y: 50 }); }; const held = await made; sum += held.y; note(name + " " + sum); } return sum; }
async function below(name) { const made = { z: 1 }; Object.setPrototypeOf(made, { then(resolve) { note(name + " then from above"); resolve("from above"); } }); return await made; }
async function throwing(name) { const made = { w: 1 }; Object.defineProperty(made, "then", { get() { note(name + " getter"); throw "thrown by the getter"; } }); try { return await made; } catch (error) { return "caught " + error; } }
async function listWithThen(name) { const made = [1, 2]; made.then = resolve => { note(name + " then of a list"); resolve("a list no longer"); }; return await made; }
async function alive(name, turns) { let whole = 1; let fraction = 0.5; const kept = { x: 3 }; for (let i = 0; i < turns; i++) { await i; whole += 2; fraction += 0.25; kept.x += 1; } note(name + " " + whole + " " + fraction + " " + kept.x); return whole + fraction + kept.x; }
report(await numbers("alone", 3));
report(await records("alone too", 3));
const together = [numbers("a", 3), records("b", 3), points("c", 3), lists("d", 3), once("e"), same("f"), thenables("g", 2), laters("h", 2), named("i", 3), below("j"), throwing("k"), listWithThen("l"), alive("m", 4)];
for (let i = 0; i < together.length; i++) { report(await together[i]); }
for (let i = 0; i < log.length; i++) { report(log[i]); }
report("end");
