const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { for (let i = 0; i < limit; i++) { switch (i % 3) { case 0: yield "zero"; break; case 1: yield "one"; default: yield "rest " + i; } } }
function run() {
  const it = steps(5);
  globalThis.held = it;
  try { for (let turn = 0; turn < 40; turn++) {  const step = it.next(turn * 2); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
