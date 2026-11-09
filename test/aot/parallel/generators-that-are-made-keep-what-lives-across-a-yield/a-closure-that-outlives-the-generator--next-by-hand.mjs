const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
const kept = []; function* steps(limit) { for (let i = 0; i < limit; i++) { let own = i * 2; kept.push(() => own++); yield own; } } function later() { return kept.splice(0).map(one => one() + one()).join(); }
function run() {
  const it = (note(later()), steps(3));
  globalThis.held = it;
  try { for (let turn = 0; turn < 40; turn++) {  const step = it.next(); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
