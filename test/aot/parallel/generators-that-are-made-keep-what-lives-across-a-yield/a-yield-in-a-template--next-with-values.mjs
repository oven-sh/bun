const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(base) { yield `${base}-${yield "hole"}-${base + 1}`; }
function run() {
  const it = steps(3);
  globalThis.held = it;
  try { for (let turn = 0; turn < 40; turn++) {  const step = it.next(turn * 2); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
