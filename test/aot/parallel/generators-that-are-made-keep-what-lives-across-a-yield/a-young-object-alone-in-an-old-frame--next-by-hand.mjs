const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function waste(depth) { const made = []; for (let j = 0; j < 4000; j++) made.push({ j, depth }); return depth ? waste(depth - 1) + made.length : made.length; } function* steps(limit) { let held = { count: 0, text: "t" }; for (let i = 0; i < limit; i++) { held = { count: held.count + 1, text: held.text + i }; yield waste(6); } yield held.count + held.text; }
function run() {
  const it = steps(30);
  globalThis.held = it;
  try { for (let turn = 0; turn < 40; turn++) { waste(6); const step = it.next(); note(step.done + " " + show(step.value)); if (step.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
