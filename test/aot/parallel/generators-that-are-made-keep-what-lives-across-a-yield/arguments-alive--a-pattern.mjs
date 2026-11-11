const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps() { yield arguments.length; for (let i = 0; i < arguments.length; i++) yield arguments[i]; }
function run() {
  const it = steps(7, "eight", 9.5);
  globalThis.held = it;
  try { const [first, second, ...others] = it; note(show(first) + " " + show(second) + " " + others.length); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
