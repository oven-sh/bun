const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* inner() { yield "in 1"; yield "in 2"; } function* steps() { const held = inner(); yield held.next().value; yield "between"; yield held.next().value; yield held.next().done; }
function run() {
  const it = steps();
  globalThis.held = it;
  try { note(it.map(show).take(4).toArray().join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
