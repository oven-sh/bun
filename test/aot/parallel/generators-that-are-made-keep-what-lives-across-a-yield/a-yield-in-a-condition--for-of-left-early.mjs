const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { let i = 0; while ((yield i) !== "stop" && i < limit) i++; return "left at " + i; }
function run() {
  const it = steps(4);
  globalThis.held = it;
  try { let seen = 0; for (const value of it) { note(show(value)); if (++seen === 3) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
