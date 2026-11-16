const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { const made = []; for (let i = 0; i < limit; i++) { made.push(() => i * 10); yield made.length; } yield made.map(one => one()).join(); }
function run() {
  const it = steps(4);
  globalThis.held = it;
  try { for (const value of it) note(show(value)); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
