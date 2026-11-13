const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(limit) { let big = 4294967296; for (let i = 0; i < limit; i++) { big += 4294967295; yield big; } }
function run() {
  const it = steps(4);
  globalThis.held = it;
  try { const other = steps(4); for (let turn = 0; turn < 12; turn++) { const a = it.next(), b = other.next(); note(show(a.value) + " " + show(b.value)); if (a.done && b.done) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
