const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(map) { for (const [key, value] of map) { yield key; yield value; } }
function run() {
  const it = steps(new Map([["k", 1], ["l", 2]]));
  globalThis.held = it;
  try { note(Array.from(it, show).join(" ")); } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
