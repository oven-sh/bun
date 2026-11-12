const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(nothing, none) { yield 1; yield nothing === undefined; yield none === null; yield String(nothing) + String(none); }
function run() {
  const it = steps(undefined, null);
  globalThis.held = it;
  try { note(Array.from(it, show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
