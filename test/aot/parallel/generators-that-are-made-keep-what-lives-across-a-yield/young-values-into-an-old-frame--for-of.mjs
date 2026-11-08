const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { let chain = null; for (let i = 0; i < limit; i++) { chain = { i, chain }; if (i % 3 === 0) Bun.gc(true); yield i; } let sum = 0; for (let at = chain; at; at = at.chain) sum += at.i; yield sum; }
function run() {
  const it = steps(10);
  globalThis.held = it;
  try { for (const value of it) note(show(value)); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
