const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
const owner = { base: 40, *steps(limit) { for (let i = 0; i < limit; i++) yield this.base + i; yield this === owner; } };
function run() {
  const it = owner.steps(3);
  globalThis.held = it;
  try { note(it.map(show).take(4).toArray().join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
