const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { for (let i = 0; i < limit; i++) { let sum = 0; for (let j = 0; j <= i * 100; j++) sum += j; yield sum; } }
function run() {
  const it = steps(4);
  globalThis.held = it;
  try { note(Array.from(it, show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
