const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(flag, first = flag ? "yes" : "no", second = first === "yes" ? 1.5 : 2) { yield first; yield second; yield flag; }
function run() {
  const it = steps(said.length % 2 === 0);
  globalThis.held = it;
  try { for (let turn = 0; turn < 40; turn++) {  const step = it.next(turn * 2); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
