const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps() { let i = 2147483646; for (let turn = 0; turn < 4; turn++) { yield i; i++; } }
function run() {
  const it = steps();
  globalThis.held = it;
  try { note(it.map(show).take(4).toArray().join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
