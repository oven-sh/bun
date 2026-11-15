const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { let total = 0; for (let i = 0; i < limit; i++) { const sent = yield total; total += sent === undefined ? 1 : sent; } return total; }
function run() {
  const it = steps(5);
  globalThis.held = it;
  try { note([...it].map(show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
