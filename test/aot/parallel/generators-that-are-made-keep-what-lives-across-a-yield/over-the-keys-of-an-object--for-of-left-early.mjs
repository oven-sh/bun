const said = []; function note(line) { said.push(String(line)); }
function show(value) { return typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
function* steps(object) { for (const key in object) yield key + "=" + object[key]; }
function run() {
  const it = steps({ a: 1, b: 2, c: 3 });
  globalThis.held = it;
  try { let seen = 0; for (const value of it) { note(show(value)); if (++seen === 3) break; } } catch (error) { note("left: " + (error && error.message || error)); }
}
for (let round = 0; round < 3; round++) { run(); note("--"); }
console.log(said.join("\n"));
