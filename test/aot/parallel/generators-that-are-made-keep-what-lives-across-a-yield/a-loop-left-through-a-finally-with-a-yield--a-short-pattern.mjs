const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { for (let i = 0; i < limit; i++) { try { if (i === 1) continue; if (i === 3) break; yield "body " + i; } finally { yield "finally " + i; } } yield "end"; }
function run() {
  const it = steps(5);
  globalThis.held = it;
  try { const [first] = it; note(show(first)); { const step = it.next(); note(step.done + " " + show(step.value)); } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
