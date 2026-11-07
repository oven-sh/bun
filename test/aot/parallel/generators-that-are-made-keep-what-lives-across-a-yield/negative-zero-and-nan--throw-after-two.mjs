const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps() { const zero = -0, none = NaN, most = Infinity; yield 1; yield Object.is(zero, -0); yield Number.isNaN(none); yield most; }
function run() {
  const it = steps();
  globalThis.held = it;
  try { note(show(it.next().value)); note(show(it.next().value)); for (let turn = 0; turn < 8; turn++) { const step = turn ? it.next() : it.throw(new Error("thrown in")); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
